"use strict"

// A field can hold any value
class Field {
	parse(input){
		return this.value = input == undefined ? null : input
	}
}

// A boolean field that parses 0 or non-zero to false or true.
class BooleanField {
	parse(input) {
		return this.value = input == undefined ? false : parseInt(input) != 0
	}
}

// An enum field can hold nothing or one of the
// values of a defined enumeration
class EnumField {
	constructor(enms) {
		this.enms = enms
	}
	parse(input) {
		var k, ref, v
		ref = this.enms

		// for of instead?
		for (k in ref) {
			v = ref[k]
			if (input === v) {
				return k
			}
		}

		return {}
	}
}

class RepeatedField {
	constructor (field) {
		if (field && (typeof field.parse !== 'function')) {
			console.trace()
		}

		this.field = field
	}

	parse (input) {
		var a, i, len, ref, results

		if(!input)
			return input

		results = []

		for (i = 0, len = input.length; i < len; i++) {
			a = input[i]
			results.push((ref = this.field) != null ? ref.parse(a) : undefined)
		}

		return results
	}
}

class Message {
	// fields is array organised as
	// [name1, val1, name2, val2, name3, val3]
	constructor(fields) {
		this.fields = fields
	}

	parse (input) {
		var a, i, k, out, len, v, val

		if(!input)
			return null

		if (input instanceof Buffer)
			input = input.toString()

		// we must eval since protojson is not proper json: [1,,""]
		if(typeof input === 'string')
			input = eval(input)

		out = {}

		/* fucking coffescript version... */

		// for a in [0...@fields.length] by 2
		//     val = input[a/2]
		//     k = @fields[a]
		//     v = @fields[a+1]
		//     out[k] = v.parse val if k
		// out

		// can probably do something smarter
		out = {}
		for (a = i = 0, len = this.fields.length; i < len; a = i += 2) {
			val = input[a / 2]
			k = this.fields[a]

			if (k) {
				v = this.fields[a + 1]
				out[k] = v.parse(val)
			}
		}

		return out
	}
}

module.exports = {Field, BooleanField, EnumField, RepeatedField, Message}