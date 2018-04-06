module.exports = (...args) => logAtLevel('\x1b[2m', 'DEBUG', ...args);
module.exports.error = (...args) => logAtLevel('\x1b[31m', 'ERROR', ...args);
module.exports.info = (...args) => logAtLevel('\x1b[32m', 'INFO', ...args);
module.exports.debug = module.exports;
module.exports.warn = (...args) => logAtLevel('\x1b[33m', 'WARN', ...args);

const TESTING = process.env.TESTING;

function logAtLevel(color, level, ...args) {
  if (!TESTING) {
    args.unshift(color + level);
    args.push('\x1b[0m'); // reset color to terminal default
    console.log.apply(console.log, args.map(redactUrls));
  }
}

const redactUrls = s => {
  if(s instanceof Error) s = s.stack;
  else if(s && typeof s !== 'string') s = JSON.stringify(s);
  return s && s.replace(/(http[s]?:\/\/[^:]*):[^@]*@/g, '$1:****@');
};
