'use strict';

var chai = require('chai');
var should = chai.should();
var expect = chai.expect;
var assert = require('assert');

var bitcore = require('bitcore');
var bloom = require('../');
var Filter = bloom.Filter;
var MurmurHash3 = bloom.MurmurHash3;
var Messages = bloom.Messages;

var fixtures = require('./data/index.json');

// convert a hex string to a bytes buffer
function ParseHex(str) {
  var result = [];
  while (str.length >= 2) {
    result.push(parseInt(str.substring(0, 2), 16));
    str = str.substring(2, str.length);
  }
  var buf = new Buffer(result, 16);
  return buf;
}

describe('Bloom', function() {

  describe('MurmurHash3', function() {

    // format: expected, seed, data
    // see: https://github.com/bitcoin/bitcoin/blob/master/src/test/hash_tests.cpp
    var data = [
      [0x00000000, 0x00000000, ''],
      [0x6a396f08, 0xFBA4C795, ''],
      [0x81f16f39, 0xffffffff, ''],
      [0x514e28b7, 0x00000000, '00'],
      [0xea3f0b17, 0xFBA4C795, '00'],
      [0xfd6cf10d, 0x00000000, 'ff'],
      [0x16c6b7ab, 0x00000000, '0011'],
      [0x8eb51c3d, 0x00000000, '001122'],
      [0xb4471bf8, 0x00000000, '00112233'],
      [0xe2301fa8, 0x00000000, '0011223344'],
      [0xfc2e4a15, 0x00000000, '001122334455'],
      [0xb074502c, 0x00000000, '00112233445566'],
      [0x8034d2a0, 0x00000000, '0011223344556677'],
      [0xb4698def, 0x00000000, '001122334455667788']
    ];

    data.forEach(function(d){
      it('seed: "'+d[1].toString(16)+'" and data: "'+d[2]+'"', function() {
        MurmurHash3(d[1], ParseHex(d[2])).should.equal(d[0]);
      });
    });

  });

  // test data from bitcoind
  // see: https://github.com/bitcoin/bitcoin/blob/master/src/test/bloom_tests.cpp
  var a = ParseHex('99108ad8ed9bb6274d3980bab5a85c048f0950c8');
  var b = ParseHex('19108ad8ed9bb6274d3980bab5a85c048f0950c8');
  var c = ParseHex('b5a2c786d9ef4658287ced5914b37a1b4aa32eee');
  var d = ParseHex('b9300670b4c5366e95b2699e8b18bc75e5f729c5');

  describe('Filter', function() {

    it('create with false positive settings', function() {
      var filter = Filter.create(100, 0.1);
      should.exist(filter.vData);
      should.exist(filter.nHashFuncs);
    });

    describe('correctly calculate size of filter and number of hash functions', function() {
      // elements, fprate, expected length, expected funcs
      // calculated with: https://github.com/petertodd/python-bitcoinlib/blob/master/bitcoin/bloom.py
      var data = [
        [2, 0.001, 3, 8],
        [3, 0.01, 3, 5],
        [10, 0.2, 4, 2],
        [100, 0.2, 41, 2],
        [10000, 0.3, 3132, 1]
      ];

      data.forEach(function(d){
        it('elements: "'+d[0]+'" and fprate: "'+d[1]+'"', function() {
          var filter = Filter.create(d[0], d[1]);
          filter.vData.length.should.equal(d[2]);
          filter.nHashFuncs.should.equal(d[3]);
        });
      });

    });

    it('add items and test if they match the filter correctly', function() {
      var filter = Filter.create(3, 0.01);
      filter.insert(a);
      assert(filter.contains(a));
      assert(!filter.contains(b));
      filter.insert(c);
      assert(filter.contains(c));
      filter.insert(d);
      assert(filter.contains(d));
    });

    it('correctly serialize to a buffer', function() {

      var filter = Filter.create(3, 0.01, 0, Filter.BLOOM_UPDATE_ALL);

      filter.insert(ParseHex('99108ad8ed9bb6274d3980bab5a85c048f0950c8'));
      assert(filter.contains(ParseHex('99108ad8ed9bb6274d3980bab5a85c048f0950c8')));

      // one bit different in first byte
      assert(!filter.contains(ParseHex('19108ad8ed9bb6274d3980bab5a85c048f0950c8')));

      filter.insert(ParseHex('b5a2c786d9ef4658287ced5914b37a1b4aa32eee'));
      assert(filter.contains(ParseHex("b5a2c786d9ef4658287ced5914b37a1b4aa32eee")));

      filter.insert(ParseHex('b9300670b4c5366e95b2699e8b18bc75e5f729c5'));
      assert(filter.contains(ParseHex('b9300670b4c5366e95b2699e8b18bc75e5f729c5')));

      var actual = filter.toBuffer();
      var expected = new Buffer('03614e9b050000000000000001', 'hex');

      actual.should.deep.equal(expected);

    });

    it('correctly serialize to a buffer with tweak', function() {

      var filter = Filter.create(3, 0.01, 2147483649, Filter.BLOOM_UPDATE_ALL);

      filter.insert(ParseHex('99108ad8ed9bb6274d3980bab5a85c048f0950c8'));
      assert(filter.contains(ParseHex('99108ad8ed9bb6274d3980bab5a85c048f0950c8')));

      // one bit different in first byte
      assert(!filter.contains(ParseHex('19108ad8ed9bb6274d3980bab5a85c048f0950c8')));

      filter.insert(ParseHex('b5a2c786d9ef4658287ced5914b37a1b4aa32eee'));
      assert(filter.contains(ParseHex('b5a2c786d9ef4658287ced5914b37a1b4aa32eee')));

      filter.insert(ParseHex('b9300670b4c5366e95b2699e8b18bc75e5f729c5'));
      assert(filter.contains(ParseHex('b9300670b4c5366e95b2699e8b18bc75e5f729c5')));

      var actual = filter.toBuffer();
      var expected = new Buffer('03ce4299050000000100008001', 'hex');
      actual.should.deep.equal(expected);

    });

    it('correctly serialize filter with public keys added', function() {

      var privateKey = bitcore.PrivateKey.fromWIF('5Kg1gnAjaLfKiwhhPpGS3QfRg2m6awQvaj98JCZBZQ5SuS2F15C');
      var publicKey = privateKey.toPublicKey();

      var filter = Filter.create(2, 0.001, 0, Filter.BLOOM_UPDATE_ALL);
      filter.insert(publicKey.toBuffer());
      filter.insert(bitcore.crypto.Hash.sha256ripemd160(publicKey.toBuffer()));

      var expectedFilter = Filter.fromBuffer(ParseHex('038fc16b080000000000000001'));

      filter.toBuffer().should.deep.equal(expectedFilter.toBuffer());

    });


    describe('correctly find relevant transaction', function() {

      var tx = new bitcore.Transaction(ParseHex(fixtures.utxo.data));
      var spendingTx = new bitcore.Transaction(ParseHex(fixtures.spendtx.data));

      it('tx hash', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        filter.insert(ParseHex('b4749f017444b051c44dfd2720e88f314ff94f3dd6d56d40ef65854fcd7fff6b'));
        assert(filter.isRelevantAndUpdate(tx));
      });

      it('byte-reversed tx hash', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        filter.insert(ParseHex('6bff7fcd4f8565ef406dd5d63d4ff94f318fe82027fd4dc451b04474019f74b4'));
        assert(filter.isRelevantAndUpdate(tx));
      });

      it('input signature', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        filter.insert(ParseHex('30450220070aca44506c5cef3a16ed519d7c3c39f8aab192c4e1c90d065f37b8a4af6141022100a8e160b856c2d43d27d8fba71e5aef6405b8643ac4cb7cb3c462aced7f14711a01'));
        assert(filter.isRelevantAndUpdate(tx));
      });

      xit('input pubkey', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        // input pubkey
        filter.insert(ParseHex('046d11fee51b0e60666d5049a9101a72741df480b96ee26488a4d3466b95c9a40ac5eeef87e10a5cd336c19a84565f80fa6c547957b7700ff4dfbdefe76036c339'));
        assert(filter.isRelevantAndUpdate(tx));
      });

      it('add output to filter', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        // output address
        filter.insert(ParseHex('04943fdd508053c75000106d3bc6e2754dbcff19'));
        assert(filter.isRelevantAndUpdate(tx));
        assert(filter.isRelevantAndUpdate(spendingTx));
      });

      it('output address', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        // output address
        filter.insert(ParseHex('a266436d2965547608b9e15d9032a7b9d64fa431'));
        assert(filter.isRelevantAndUpdate(tx));
      });

      it('outpoint', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        // coutpoint
        filter.insert(ParseHex('90c122d70786e899529d71dbeba91ba216982fb6ba58f3bdaab65e73b7e9260b'));
        assert(filter.isRelevantAndUpdate(tx));
      });

      it('manually serialized outpoint', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        var data = new bitcore.encoding.BufferReader(
          ParseHex('90c122d70786e899529d71dbeba91ba216982fb6ba58f3bdaab65e73b7e9260b')
        ).readReverse();
        filter.insert(data);
        assert(filter.isRelevantAndUpdate(tx));
      });

      it('random tx hash', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        filter.insert(ParseHex('00000009e784f32f62ef849763d4f45b98e07ba658647343b915ff832b110436'));
        assert(!filter.isRelevantAndUpdate(tx));
      });

      it('random address', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        // random address
        filter.insert(ParseHex('0000006d2965547608b9e15d9032a7b9d64fa431'));
        assert(!filter.isRelevantAndUpdate(tx));
      });

      xit('nonrelevant outpoint', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        //todo: outpoint define
        filter.insert(ParseHex('90c122d70786e899529d71dbeba91ba216982fb6ba58f3bdaab65e73b7e9260b'));
        assert(!filter.isRelevantAndUpdate(tx));
      });

      it('nonrelevant outpoint of output', function() {
        var filter = Filter.create(10, 0.000001, 0, Filter.BLOOM_UPDATE_ALL);
        filter.insert(ParseHex('000000d70786e899529d71dbeba91ba216982fb6ba58f3bdaab65e73b7e9260b'));
        assert(!filter.isRelevantAndUpdate(tx));
      });

    });

    it('correctly deserialize a buffer', function() {

      var buffer = new Buffer('03614e9b050000000000000001', 'hex');
      var filter = Filter.fromBuffer(buffer);

      assert(filter.contains(ParseHex('99108ad8ed9bb6274d3980bab5a85c048f0950c8')));
      assert(!filter.contains(ParseHex('19108ad8ed9bb6274d3980bab5a85c048f0950c8')));
      assert(filter.contains(ParseHex("b5a2c786d9ef4658287ced5914b37a1b4aa32eee")));
      assert(filter.contains(ParseHex('b9300670b4c5366e95b2699e8b18bc75e5f729c5')));

    });

    it('clear the filter', function() {
      var filter = Filter.create(1, 0.01);
      filter.insert(a);
      assert(filter.contains(a));
      filter.clear();
      assert(!filter.contains(a));
    });

  });

  describe('Messages', function() {

    it('construct "filterload" message', function() {
      var filter = Filter.create(10, 0.01);
      filter.insert(a);
      var message = new Messages.FilterLoad(filter);
      should.exist(message.filter);
      expect(message.filter).to.be.an.instanceof(Filter);
      message.command.should.equal('filterload');
    });

  });

});
