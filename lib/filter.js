'use strict';

var _ = require('lodash');
var MurmurHash3 = require('./murmurhash3');
var JSUtil = require('bitcore/lib/util/js');
var BufferReader = require('bitcore/lib/encoding/bufferreader');
var BufferWriter = require('bitcore/lib/encoding/bufferwriter');
var Transaction = require('bitcore/lib/transaction');

function Filter(arg) {
  /* jshint maxcomplexity: 10 */
  if (_.isObject(arg)) {
    if (!arg.vData) {
      throw new TypeError('Data object should include filter data "vData"');
    }
    this.vData = arg.vData || [];
    if (!arg.nHashFuncs) {
      throw new TypeError('Data object should include number of hash functions "nHashFuncs"');
    }
    this.nHashFuncs = arg.nHashFuncs;
    this.nTweak = arg.nTweak || 0;
    this.nFlags = arg.nFlags || Filter.BLOOM_UPDATE_NONE;
  } else {
    throw new TypeError('Unrecognized argument');
  }
}

Filter._transformBufferReader = function _transformBufferReader(br) {
  var info = {};
  var length = br.readUInt8();
  info.vData = [];
  for(var i = 0; i < length; i++) {
    info.vData.push(br.readUInt8());
  }
  info.nHashFuncs = br.readUInt32LE();
  info.nTweak = br.readUInt32LE();
  info.nFlags = br.readUInt8();
  return info;
};

Filter.fromBuffer = function(buffer) {
  var bw = new BufferReader(buffer);
  var info = Filter._transformBufferReader(bw);
  return new Filter(info);
};

Filter.prototype.toBuffer = function() {
  return this.toBufferWriter().concat();
};

Filter.prototype.toBufferWriter = function toBufferWriter(bw) {
  if (!bw) {
    bw = new BufferWriter();
  }
  bw.writeUInt8(this.vData.length);
  for(var i = 0; i < this.vData.length; i++) {
    bw.writeUInt8(this.vData[i]);
  }
  bw.writeUInt32LE(this.nHashFuncs);
  bw.writeUInt32LE(this.nTweak);
  bw.writeUInt8(this.nFlags);
  return bw;
};

Filter.fromObject = function(data) {
  var info = {
    vData: data.vData,
    nHashFuncs: data.nHashFuncs,
    nTweak: data.nTweak,
    nFlags: data.nFlags
  };
  return new Filter(info);
};

Filter.prototype.toObject = function toObject() {
  return {
    vData: this.vData,
    nHashFuncs: this.nHashFuncs,
    nTweak: this.nTweak,
    nFlags: this.nFlags
  };
};

Filter.fromJSON = function(data) {
  if (JSUtil.isValidJSON(data)) {
    data = JSON.parse(data);
  }
  return Filter.fromObject(data);
};

Filter.prototype.toJSON = function() {
  JSON.stringify(this.toObject());
};

Filter.create = function create(elements, falsePositiveRate, nTweak, nFlags) {
  /* jshint maxstatements: 18 */

  var info = {};

  // The ideal size for a bloom filter with a given number of elements and false positive rate is:
  // * - nElements * log(fp rate) / ln(2)^2
  // See: https://github.com/bitcoin/bitcoin/blob/master/src/bloom.cpp
  var size = -1.0 / Filter.LN2SQUARED * elements * Math.log(falsePositiveRate);
  var filterSize = Math.floor(size / 8);
  var max = Filter.MAX_BLOOM_FILTER_SIZE * 8;
  if (filterSize > max) {
    filterSize = max;
  }
  info.vData = [];
  for (var i = 0; i < filterSize; i++) {
    info.vData.push(0);
  }

  // The ideal number of hash functions is:
  // filter size * ln(2) / number of elements
  // See: https://github.com/bitcoin/bitcoin/blob/master/src/bloom.cpp
  var nHashFuncs = Math.floor(info.vData.length * 8 / elements * Filter.LN2);
  if (nHashFuncs > Filter.MAX_HASH_FUNCS) {
    nHashFuncs = Filter.MAX_HASH_FUNCS;
  }
  if (nHashFuncs < Filter.MIN_HASH_FUNCS) {
    nHashFuncs = Filter.MIN_HASH_FUNCS;
  }

  info.nHashFuncs = nHashFuncs;
  info.nTweak = nTweak;
  info.nFlags = nFlags;

  return new Filter(info);

};

Filter.prototype.hash = function hash(nHashNum, vDataToHash) {
  var h = MurmurHash3(((nHashNum * 0xFBA4C795) + this.nTweak) & 0xFFFFFFFF, vDataToHash);
  return h % (this.vData.length * 8);
};

Filter.prototype.insert = function insert(data) {
  for (var i = 0; i < this.nHashFuncs; i++) {
    var index = this.hash(i, data);
    var position = (1 << (7 & index));
    this.vData[index >> 3] |= position;
  }
  return this;
};

/**
 * @param {Buffer} Data to check if exists in the filter
 * @returns {Boolean} If the data matches
 */
Filter.prototype.contains = function contains(data) {
  if (!this.vData.length) {
    return false;
  }
  for (var i = 0; i < this.nHashFuncs; i++) {
    var index = this.hash(i, data);
    if (!(this.vData[index >> 3] & (1 << (7 & index)))) {
      return false;
    }
  }
  return true;
};

/**
 * Will check to see if a Transaction is relevant to the filter, and
 * will update the filter with relevant new data.
 *
 * @param {Transaction} Transaction to check if exists in the filter
 * @returns {Boolean} If the transaction matches
 */
Filter.prototype.isRelevantAndUpdate = function isRelevantAndUpdate(transaction) {
  /* jshint maxcomplexity: 8, maxstatements: 40 */

  if (!(transaction instanceof Transaction)) {
    throw new TypeError('First argument must be an instance of Transaction');
  }
  var found = false;
  if (!this.vData.length) {
    return false;
  }

  var reversed = transaction._getHash();
  var hash = new BufferReader(reversed).readReverse();

  if (this.contains(hash) || this.contains(reversed)) {
    found = true;
  }

  for (var i = 0; i < transaction.outputs.length; i++) {
    var output = transaction.outputs[i];

    // Match if the filter contains any arbitrary script data element in any scriptPubKey in tx
    // If this matches, also add the specific output that was matched.
    // This means clients don't have to update the filter themselves when a new relevant tx
    // is discovered in order to find spending transactions, which avoids round-tripping and
    // race conditions.
    // @see https://github.com/bitcoin/bitcoin/blob/master/src/bloom.cpp

    var script = output.script;
    if (script.isPublicKeyHashOut()) {

      var scriptPublicKey = script.getPublicKeyHash();

      if (scriptPublicKey && this.contains(scriptPublicKey)) {
        found = true;
        if ((this.nFlags & Filter.BLOOM_UPDATE_MASK) === Filter.BLOOM_UPDATE_ALL) {
          this.insert(hash); //todo: outpoint
        } else if ((this.nFlags & Filter.BLOOM_UPDATE_MASK) === Filter.BLOOM_UPDATE_P2PUBKEY_ONLY) {
          if (script.isPublicKeyOut() || script.isMultiSigOut()) {
            this.insert(hash); //todo: outpoint
          }
        }
      }
    }
  }

  if (found) {
    return true;
  }

  for (var i = 0; i < transaction.inputs.length; i++) {

    var input = transaction.inputs[i];

    // Match if the filter contains an outpoint tx spends
    var prevTxId = input.prevTxId;
    var reversedTxPrevId = new BufferReader(prevTxId).readReverse();
    if (this.contains(prevTxId) || this.contains(reversedTxPrevId)) {
      return true;
    }

    // Match if the filter contains any arbitrary script data element in any scriptSig in tx
    var chunks = input.script.chunks;
    for(var s = 0; s < chunks.length; s++) {
      var buffer = chunks[i].buf;
      if (buffer && buffer.length) {
        if (this.contains(buffer)) {
          return true;
        }
      }
    }

  }

  return false;

};

Filter.prototype.clear = function clear() {
  this.vData = [];
};

Filter.prototype.inspect = function inspect() {
  return '<BloomFilter: ' + this.toString() + '>';
};

Filter.prototype.toString = function toString() {
  return this.toBuffer().toString('hex');
};

JSUtil.defineImmutable(Filter, {
  BLOOM_UPDATE_NONE: 0,
  BLOOM_UPDATE_ALL: 1,
  BLOOM_UPDATE_P2PUBKEY_ONLY: 2,
  BLOOM_UPDATE_MASK: 3,
  MAX_BLOOM_FILTER_SIZE: 36000, // bytes
  MAX_HASH_FUNCS: 50,
  MIN_HASH_FUNCS: 1,
  LN2SQUARED: Math.pow(Math.log(2), 2), // 0.4804530139182014246671025263266649717305529515945455
  LN2: Math.log(2) // 0.6931471805599453094172321214581765680755001343602552
});

module.exports = Filter;
