'use strict';
const co = require('co')


/**
 * Wraps static and instance methods whose name ends with Async, or are
 * GeneratorFunctions. Any GeneratorFunction is wrapped with
 * bluebird.coroutine(), and others with bluebird.method(). Accepts an optional
 * array of method names, wrapping only those found in the array, and disabling
 * the Async suffix check. Returns the class.
 *
 * @param   {function} klass         The class to wrap
 * @param   {string[]} [methodNames] Optional array of method names
 * @returns {function} The supplied class
 * @throws  {Error}    If methodNames is provided, but is not an array
 */
function wrap(klass, methodNames) {
  validateMethodNames(methodNames);
  wrapStaticMethods(klass, methodNames);
  wrapInstanceMethods(klass, methodNames);
  return klass;
}

/**
 * Wraps static methods whose name ends with Async or are GeneratorFunctions.
 * Any GeneratorFunction is wrapped with bluebird.coroutine(), and others with
 * bluebird.method(). Accepts an optional array of method names, wrapping only
 * those found in the array, and disabling the Async suffix check. Returns the
 * class.
 *
 * @param   {function} klass         The class to wrap
 * @param   {string[]} [methodNames] Optional array of method names
 * @returns {function} The supplied class
 * @throws  {Error}    If methodNames is provided, but is not an array
 */
function wrapStaticMethods(klass, methodNames) {
  validateMethodNames(methodNames);
  wrapFunctions(klass, methodNames, klass);
  return klass;
}

/**
 * Wraps instance methods whose name ends with Async, or are GeneratorFunctions.
 * Any GeneratorFunction is wrapped with bluebird.coroutine(), and others with
 * bluebird.method(). Accepts an optional array of method names, wrapping only
 * those found in the array, and disabling the Async suffix check. Returns the
 * class.
 *
 * @param   {function} klass         The class to wrap
 * @param   {string[]} [methodNames] Optional array of method names
 * @returns {function} The supplied class
 * @throws  {Error}    If methodNames is provided, but is not an array
 */
function wrapInstanceMethods(klass, methodNames) {
  validateMethodNames(methodNames);
  wrapFunctions(klass.prototype, methodNames, klass);
  return klass;
}

/**
 * Helper function that validates the methodNames parameter.
 *
 * @param {string[]} [methodNames] Optional array of method names
 * @throws {Error}   If methodNames is provided, but is not an array
 */
function validateMethodNames(methodNames) {
  if (methodNames && !(methodNames instanceof Array)) {
    throw new Error('Optional methodNames should be an array if provided');
  }
}

function wrapFunctions(target, methodNames, klass) {

  new Error()

  _actualMethodKeys(target).forEach(function(key) {
    let constructor = target[key].constructor.name;
    let name = klass.name

    if (methodNames) {
      if (methodNames.indexOf(key) === -1) return;
    } else if (!key.endsWith('Async') && constructor !== 'GeneratorFunction') {
      return
    }

    if (target[key].constructor.name === 'GeneratorFunction') {
      target[key] = co.wrap(target[key])
    }

  });
}

function _actualMethodKeys(target) {
  return Object.getOwnPropertyNames(target)
    .filter(key => {
      var propertyDescriptor = Object.getOwnPropertyDescriptor(target, key);
      return !propertyDescriptor.get && !propertyDescriptor.set;
    })
    .filter(key => typeof target[key] === 'function');
}

module.exports = {
	co,
	wrap,
	wrapStaticMethods,
	wrapInstanceMethods
}