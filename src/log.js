const debug = require('debug');

module.exports.debug = debug('horti:debug');
module.exports.info = debug('horti:info');
module.exports.warn = debug('horti:warn');
module.exports.error = debug('horti:error');
module.exports.stage = debug('horti:stage');
