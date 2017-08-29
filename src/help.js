const fs = require('fs'),
      path = require('path');

const pluckOptionsFromReadme = () => {
  const readmePath = path.join(__dirname, '..', 'README.md');
  let readmeString = fs.readFileSync(readmePath, 'utf8');

  // Everything before options
  readmeString = readmeString.replace(/[\s\S]*# Options/, '# Options');
  // And everything from the next major section onwards
  readmeString = readmeString.replace(/\n# [\s\S]*/, '');

  return readmeString;
};

module.exports = {
  outputVersion: () => {
    const package = require('../package');
    console.log(`Horticulturalist ${package.version}`);
  },
  outputHelp: () => {
    module.exports.outputVersion();
    console.log();
    console.log(pluckOptionsFromReadme());
  }
};
