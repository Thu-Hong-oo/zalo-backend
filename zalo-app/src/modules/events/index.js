// const EventEmitter = require('events');

// class EventManager extends EventEmitter {
//   constructor() {
//     super();
//     this.setMaxListeners(100); // Increase max listeners if needed
//   }

//   /**
//    * Emit an event with data
//    * @param {string} eventName - Name of the event
//    * @param {any} data - Event data
//    */
//   emitEvent(eventName, data) {
//     this.emit(eventName, data);
//   }

//   /**
//    * Listen for an event
//    * @param {string} eventName - Name of the event
//    * @param {Function} handler - Event handler function
//    */
//   onEvent(eventName, handler) {
//     this.on(eventName, handler);
//   }

//   /**
//    * Listen for an event once
//    * @param {string} eventName - Name of the event
//    * @param {Function} handler - Event handler function
//    */
//   onceEvent(eventName, handler) {
//     this.once(eventName, handler);
//   }

//   /**
//    * Remove event listener
//    * @param {string} eventName - Name of the event
//    * @param {Function} handler - Event handler function
//    */
//   offEvent(eventName, handler) {
//     this.off(eventName, handler);
//   }
// }

// const eventManager = new EventManager();

// module.exports = {
//   emitEvent: eventManager.emitEvent.bind(eventManager),
//   onEvent: eventManager.onEvent.bind(eventManager),
//   onceEvent: eventManager.onceEvent.bind(eventManager),
//   offEvent: eventManager.offEvent.bind(eventManager)
// }; 