"use strict"

var fs = require('fs')
var deql = require('chai').assert.deepEqual

var PushDataParser = require('../src/pushdataparser')

var CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE = require('../src/schema').CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE

describe('CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE', () => {

    it('parses', () => {
        var msg = fs.readFileSync('./test/syncall.bin')
        var x = CLIENT_SYNC_ALL_NEW_EVENTS_RESPONSE.parse(msg)
        deql(x.response_header, {
            current_server_time: 1430641400746000,
            request_trace_id: "-6693534691558475312",
            status: 1
        })
        deql(x.sync_timestamp, 1430641100747000)
        deql(x.conversation_state[0].event[4].chat_message.message_content.segment[0].text, 'tja bosse')
    })
})