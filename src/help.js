const fs = require('fs'),
      path = require('path');

const {info} = require('./log');

const pluckOptionsFromReadme = () => {
  const readmePath = path.join(__dirname, '..', 'README.md');
  let readmeString = "\n" + fs.readFileSync(readmePath, 'utf8');

  // Everything before options
  readmeString = readmeString.replace(/[\s\S]*# Options/, '# Options');
  // And everything from the next major section onwards
  readmeString = readmeString.replace(/\n# [\s\S]*/, '');

  return readmeString;
};

module.exports = {
  outputVersion: () => {
    const package = require('../package');
    info(`Horticulturalist ${package.version}`);
  },
  outputHelp: () => {
    module.exports.outputVersion();
    info(pluckOptionsFromReadme());
  }
};
