'use strict';

var Message = require('bitcore/lib/transport/messages').Message;
var Filter = require('./filter');
var util = require('util');

/**
 * Filter Load Message
 *
 * @param{Filter} filter - an instance of a Bitcore Bloom Filter
 */
function FilterLoad(filter) {
  this.command = 'filterload';
  this.filter = filter;
}
util.inherits(FilterLoad, Message);

FilterLoad.prototype.fromBuffer = function(payload) {
  this.filter = Filter.fromBuffer(payload);
  return this;
};

FilterLoad.prototype.getPayload = function() {
  return this.filter.toBuffer();
};

module.exports.FilterLoad = FilterLoad;
