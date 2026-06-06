const baseConfig = require('./app.json');

const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
const apiBase = replitDevDomain ? `https://${replitDevDomain}` : '';

module.exports = {
  ...baseConfig.expo,
  extra: {
    apiBase,
  },
};
