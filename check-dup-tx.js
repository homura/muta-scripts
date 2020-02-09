const program = require('commander');

const { Muta } = require('muta-sdk');

require('debug').enable('dup:*');
const trace = require('debug')('dup:trace');
const error = require('debug')('dup:error');

program
  .option('-h --host <host>', 'host', '127.0.0.1')
  .option('-p --port <port>', 'port', '8000')
  .option('-s --start <start>', 'starts block', 1)
  .option('-e --end <end>', 'ends block', 0)
  .option('--verbose', 'verbose info for debug', false)
  .option(
    '-m --max-size <maxSize>',
    'clear when tx cache when oversize',
    5000000
  );

program.parse(process.argv);

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function parseNumber(x, defaults = 0) {
  const x1 = Number(x);
  return Number.isNaN(x) ? 1 : x1;
}

class DupChecker {
  constructor(options) {
    const { start, host, port, maxSize, verbose } = program;

    /**
     * starts with the block
     * @type {number}
     */
    this.startBlock = parseNumber(start, 1);

    /**
     * checking until height reach endBlock
     * @type {number}
     */
    this.endBlock = 0;

    /**
     * the max size of cache
     * @type {number}
     */
    this.maxCacheSize = parseNumber(maxSize, 5000000);

    /**
     * Muta instance
     * @type {Muta}
     */
    this.mutaInstance = new Muta({
      endpoint: `http://${host}:${port}/graphql`,
      chainId:
        '0xb6a4d7da21443f5e816e8700eea87610e6d769657d6b8ec73028457bf2ca4036'
    });

    /**
     * Muta RPC client
     * @type {Client}
     */
    this.client = this.mutaInstance.client();

    /**
     * cache txhash and block height, clear when the size large then maxCacheSize
     * @type {Map<String, Number>}
     */
    this.cache = new Map();

    this.state = {
      /**
       * total checked tx count
       */
      totalTx: 0,

      /**
       * current checking block height
       */
      height: this.startBlock
    };
  }

  async refreshEndHeight() {
    this.endBlock = await this.client.getLatestBlockHeight();
  }

  printStatus() {
    const { height, totalTx } = this.state;

    trace(`#${height}/${this.endBlock}: tx count ${totalTx}`);
  }

  recordTxHash(txHash) {
    const cache = this.cache;
    const height = this.state.height;
    const maxCacheSize = this.maxCacheSize;

    if (cache.size >= maxCacheSize) {
      cache.clear();
    }

    if (cache.has(txHash)) {
      const dupHeight = cache.get(txHash);
      error(
        `found duplicate in block #${dupHeight} and #${height}: tx ${txHash} with block `
      );
      process.exit(1);
    } else {
      this.cache.set(txHash, height);
      this.state.totalTx++;
    }
  }

  async run() {
    const client = this.client;
    await this.refreshEndHeight();

    while (1) {
      let block;

      try {
        block = await client.getRawClient().getBlock({
          height: this.state.height.toString(16)
        });
      } catch (e) {
        if (e.message.includes('GetNone')) {
          this.printStatus();
          await this.refreshEndHeight();
        } else {
          error(e);
        }

        await delay(500);
        continue;
      }

      if (!block || !block.getBlock) {
        await delay(500);
      }

      block.getBlock.orderedTxHashes.forEach(tx => this.recordTxHash(tx));
      this.printStatus();
      this.state.height++;
    }
  }
}

new DupChecker().run();
