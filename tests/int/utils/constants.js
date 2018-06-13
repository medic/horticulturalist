module.exports = {
  BUILDS_URL: process.env.HORTI_TEST_BUILDS || 'http://admin:pass@localhost:5984/test-medic-builds',
  APP_URL: process.env.HORTI_TEST_APPS || 'http://admin:pass@localhost:5984/test-horti-app',
  API_PORT: 5998
};
