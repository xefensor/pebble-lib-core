'use strict';

// Source coordination is independent of watchface layout and settings UI.
// Every factory receives its host APIs, message keys and clock explicitly.
module.exports = {
  createMessageQueue: require('./message-queue'),
  createComplications: require('./complications'),
  createContext: require('./context'),
  wire: require('./complication-data')
};
