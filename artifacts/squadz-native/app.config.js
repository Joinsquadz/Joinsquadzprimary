const baseConfig = require('./app.json');

const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
const apiBase = replitDevDomain ? `https://${replitDevDomain}` : '';

module.exports = {
  ...baseConfig.expo,
  ios: {
    ...baseConfig.expo.ios,
    buildNumber: "6",
    infoPlist: {
      ...baseConfig.expo.ios.infoPlist,
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    ...baseConfig.expo.android,
    versionCode: 7,
  },
  extra: {
    apiBase,
    eas: {
      projectId: "4651d477-18ad-41a3-b15a-90b68b981652",
    },
  },
};
