"use strict"

var fs = require('fs')
var deql = require('chai').assert.deepEqual

var PushDataParser = require('../src/pushdataparser')

describe('PushDataParser', () => {

    var p
    beforeEach(() => {
        p = new PushDataParser()
    })

    it('parses sid/gsid', () => {
        var msg = fs.readFileSync('./test/sidgsid.bin', null)
        var lines = p.parse(msg)
        deql(lines, 1)
        // var s = p.pop()
        // [_,[_,sid]] = s[0]
        // [_,[{gsid}]] = s[1]
        // deql(sid, '9EB0A0FABFF8FB97')
        // deql(gsid, 'iMyLjHNOp8jTdYnYP4ophA')
    })

    it('handles chopped off len specifications', () => {
        var msg1 = new Buffer('1')
        var lines = p.parse(msg1)
        deql(lines, 0)
        deql(p.leftover, new Buffer('1'))
        var msg2 = new Buffer('0\n1234567890')
        lines = p.parse(msg2)
        deql(lines, 1)
        deql(p.leftover, null)
    })

    it('handles chopped off data', () => {
        var msg = new Buffer('10\n1234')
        var lines = p.parse(msg)
        deql(lines, 0)
        deql(p.leftover, new Buffer('10\n1234'))
        msg = new Buffer('567890')
        lines = p.parse(msg)
        deql(lines, 1)
        deql(p.leftover, null)
    })

    describe('allLines', () => {
        it('is a promise for all the lines read', done => {
            p.allLines().then(lines => {
                deql(lines, ['abc', 'def'])
                done()
            })
            p.parse(new Buffer('5\n"abc"5\n"def"'))
        })
    })
})