'use strict';

// Hosts with an independent activity engine need not bundle legacy context.
// Services, message dispatch and settings remain owned by the host.
module.exports = {
  createMessageQueue: require('./message-queue'),
  createComplications: require('./complications'),
  wire: require('./complication-data')
};
