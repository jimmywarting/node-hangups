"use strict"

var SegmentType = require('./schema').SegmentType

// Helper class to make message segments.
module.exports = class MessageBuilder {

	constructor() {
		this.segments = []
		this.segsjson = []
	}

	text (txt, bold, italic, strikethrough, underline, href) {
		var format, link

		var seg = [SegmentType.TEXT, txt]
		var segj = {
			text: txt,
			type: "TEXT"
		}
		if (bold || italic || strikethrough || underline) {
			seg[2] = format = []
			segj.formatting = {}
			format[0] = bold ? 1 : null
			format[1] = italic ? 1 : null
			format[2] = strikethrough ? 1 : null
			format[3] = underline ? 1 : null

			bold && (segj.formatting.bold = 1 )
			italic && (segj.formatting.italic = 1 )
			strikethrough && (segj.formatting.strikethrough = 1 )
			underline && (segj.formatting.underline = 1 )
		}

		if (href) {
			seg[0] = SegmentType.LINK
			segj.type = "LINK"
			seg[2] = seg[2] || null
			seg[3] = link = []
			link[0] = href
			segj.link_data = {link_target: href}
		}

		this.segments.push(seg)
		this.segsjson.push(segj)

		return this
	}

	bold(txt) { return this.text(txt, true) }
	italic(txt) { return this.text(txt, false, true) }
	strikethrough(txt) { return this.text(txt, false, false, true) }
	underline(txt) { return this.text(txt, false, false, false, true) }
	link(txt, href) { return this.text(txt, false, false, false, false, href) }

	linebreak(){
		var seg = [SegmentType.LINE_BREAK, '\n']
		var segj = {text:'\n', type:'LINE_BREAK'}
		this.segments.push(seg)
		this.segsjson.push(segj)
		return this
	}

	toSegments(){ return this.segments }
	toSegsjson(){ return this.segsjson }
}