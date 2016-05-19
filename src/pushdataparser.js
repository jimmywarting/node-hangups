"use strict"

function findNextLf(buf, start) {
	var i = start
	var len = buf.length

	while (i < len){
		if (buf[i] == 10)
			return i
		i++
	}

	return -1
}

// Parser for format that is
//
// <len spec>\n<data>
// <len spec>\n<data>
//
module.exports = class PushDataParser {

	constructor (data) {
		this.lines = []
		this.leftover = null

		if (data)
			this.parse(data)
	}

	parse (newdata) {
		var available, end, i, len, line, n, start

		let data = this.leftover ? Buffer.concat([this.leftover, newdata]) : newdata

		this.leftover = null
		i = 0
		while ((n = findNextLf(data, i)) >= 0) {
			len = JSON.parse(data.slice(i, n).toString())
			start = n + 1
			end = n + 1 + len
			if ( !(end <= data.length) )
				break

			line = JSON.parse(data.slice(start, end).toString())
			this.lines.push(line)
			i = end
		}

		if (i < data.length)
			this.leftover = data.slice(i)

		available = this.available()

		if (available && this.def) {
			this.def.resolve(this.lines)
			this.def = null
			this.lines = []
		}

		return available
	}

	available () {
		return this.lines.length
	}

	pop () {
		return this.lines.pop()
	}

	// once we understand this bloody code
	allLines () {

		// Darn anti promise pattern...
		// refactor to promise A+ maybe?
        var def = this.def || (a=>(a={},a.promise=new Promise((b,c)=>(a.resolve=b,a.reject=c)),a))()

        if (this.lines.length) {
            def.resolve(lines)
            this.def = null
            this.lines = []
        } else {
            this.def = def
        }

        return def.promise
	}

	reset (err) {
		if (this.def) {
			err ? this.def.reject(err)
				: this.def.resolve([])

			this.def = null
		}

		this.lines = []
		this.leftover = null
	}
}