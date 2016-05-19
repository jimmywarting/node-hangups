"use strict"

var debug = require('debug')('hangups:messageparser')
var util = require('./util')
var tryparse = util.tryparse
var oResolve = util.oResolve
var CLIENT_STATE_UPDATE = require('./schema').CLIENT_STATE_UPDATE

var CLIENT_EVENT_PARTS = [
	'chat_message',
	'membership_change',
	'conversation_rename',
	'hangout_event'
]

class MessageParser {

	constructor(emitter){
		this.emitter = emitter
	}

	parsePushLines (lines){
		lines.forEach(line => this.parsePushLine(line))
	}

	parsePushLine (line) {
		var data, obj, sub

		for (sub of line) {
			data = oResolve(sub, '1.0')
			if (data){
				if (data == 'noop')
					this.emit('noop')
				else if (data && data.p)
					obj = tryparse(data.p)
				if (oResolve(obj, '3.2'))
					this.emit('clientid', obj['3']['2'])
				if (oResolve(obj, '2.2'))
					this.parsePayload(obj['2']['2'])
				else
					debug('failed to parse', line)
			}
		}
	}

	parsePayload (payload) {
		var u
		if (typeof payload === 'string')
			payload = tryparse(payload)

		// XXX when we get a null payload on an incoming hangout_event
		// i wonder whether we *actually* got a null payload, or if we
		// simply misinterpreted what's coming at some step.
		if(!payload)
			return

		if (payload && payload[0] == 'cbu'){
			for (u of payload[1]) {
				var update = CLIENT_STATE_UPDATE.parse(u)
				this.emitUpdateParts(update)
			}
		}
		else {
			debug('ignoring payload', payload)
		}
	}

	emitUpdateParts (update) {
		var eventname, k, value,
			header = update.state_update_header

		for (k in update) {
			value = update[k]
			eventname = (k.match(/(.*)_notification/) || [])[1]

			if (!(eventname && value))
				continue

			if (eventname == 'event') {
				// further split the nebulous "CLIENT_EVENT"
				this.emitEventParts(header, value.event)
			}

			else {
				value._header = header
				this.emit(eventname, value)
			}
		}
	}

	emitEventParts (header, event) {
		var i, ks, len, part, results, obj

		for (part of CLIENT_EVENT_PARTS) {

			if (!event[part])
				continue

			obj = {}

			Object.keys(event).forEach(k => {
				if(event[k] && (k === part || !CLIENT_EVENT_PARTS.indexOf(k) !== -1)){
					obj[k] = event[k]
				}
			})

			this.emit(part, obj)
		}
	}


	emit(ev, data) {
		this.emitter && this.emitter.emit(ev, data)
	}

}

module.exports = require('./wrap').wrap(MessageParser)
