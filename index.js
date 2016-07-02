var async = require('async')
var debug = require('debug')('node-boot:index')
var format = require('util').format
var Toposort = require('toposort-class')
var get = require('lodash.get')
var set = require('lodash.set')
var has = require('lodash.has')
var map = require('lodash.map')
var find = require('lodash.find')
var toArray = require('lodash.toarray')
var intersection = require('lodash.intersection')

module.exports = function() {

    var definitions = {}
    var current

    function add(name, component) {
        debug('Adding %s', name)
        if (definitions.hasOwnProperty(name)) throw new Error(format('Duplicate component: %s', name))
        if (!component) throw new Error(format('Component %s is null or undefined', name))
        if (!component.start) throw new Error(format('Component %s is missing a start function', name))
        definitions[name] = { component: component, dependencies: [] }
        current = name
        return api
    }

    function dependsOn() {
        if (!current) throw new Error('You must add a component before calling dependsOn')
        definitions[current].dependencies = toArray(arguments).reduce(toDependencyDefinitions, definitions[current].dependencies)
        return api
    }

    function toDependencyDefinitions(accumulator, arg) {
        var source = typeof arg === 'string' ? arg : Object.keys(arg)[0]
        var destination = typeof arg === 'string' ? arg : arg[source]
        if (find(definitions[current].dependencies, { source: source })) throw new Error(format('Component %s has a duplicate dependency %s', current, source))
        if (find(definitions[current].dependencies, { destination: destination })) throw new Error(format('Component %s has a duplicate dependency %s', current, destination))
        return accumulator.concat({ source: source, destination: destination })
    }

    function start(cb) {
        debug('Starting system')
        async.seq(sortComponents, startComponents, function(components, cb) {
            debug('System started')
            cb(null, components)
        })(cb)
        return api
    }

    function startComponents(components, cb) {
        async.reduce(components.reverse(), {}, toSystem, cb)
    }

    function toSystem(system, name, cb) {
        getDependencies(name, system, function(err, dependencies) {
            if (err) return cb(err)
            startComponent(dependencies, name, system, cb)
        })
    }

    function startComponent(dependencies, name, system, cb) {
        debug('Starting component %s', name)
        definitions[name].component.start(dependencies, function(err, started) {
            if (err) return cb(err)
            set(system, name, started)
            debug('Component %s started', name)
            cb(null, system)
        })
    }

    function stop(cb) {
        debug('Stopping system')
        async.seq(sortComponents, stopComponents, function(cb) {
            debug('System stopped')
            cb()
        })(cb || noop)
        return api
    }

    function stopComponents(components, cb) {
        async.each(components, stopComponent, cb)
    }

    function stopComponent(name, cb) {
        debug('Stopping component %s', name)
        var stop = definitions[name].component.stop || noop
        stop(function(err, started) {
            if (err) return cb(err)
            debug('Component %s stopped', name)
            cb(null)
        })
    }

    function sortComponents(cb) {
        var result = []
        try {
            var graph = new Toposort()
            Object.keys(definitions).forEach(function(name) {
                graph.add(name, map(definitions[name].dependencies, 'source'))
            })
            result = intersection(graph.sort(), Object.keys(definitions))
        } catch (err) {
            return cb(err)
        }
        return cb(null, result)
    }

    function getDependencies(name, system, cb) {
        async.reduce(definitions[name].dependencies, {}, function(accumulator, dependency, cb) {
            if (!has(system, dependency.source)) return cb(new Error(format('Component %s has an unsatisfied dependency on %s', name, dependency.source)))
            debug('Preparing dependency %s as %s', dependency.source, dependency.destination)
            set(accumulator, dependency.destination, get(system, dependency.source))
            cb(null, accumulator)
        }, cb)
    }

    function noop(cb) {
        cb && cb()
    }

    var api = {
        add: add,
        dependsOn: dependsOn,
        start: start,
        stop: stop
    }

    return api
}