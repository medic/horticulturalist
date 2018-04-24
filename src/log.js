const debug = require('debug');

module.exports.debug = debug('horti:debug');
module.exports.stage = debug('horti:stage');
module.exports.info = console.log;
module.exports.error = console.error;

if (!process.env.TESTING) {
  debug.enable('horti:*');
}
