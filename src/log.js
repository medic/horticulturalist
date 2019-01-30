const debug = require('debug');

module.exports.debug = debug('horti:debug');
module.exports.stage = debug('horti:stage');
module.exports.info = console.log; //eslint-disable-line
module.exports.error = console.error; //eslint-disable-line

if (!process.env.TESTING) {
  debug.enable('horti:*');
}
