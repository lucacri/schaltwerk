import { describe, it, expect } from 'vitest'
import { renderTemplate } from './templateRenderer'

describe('renderTemplate', () => {
    it('replaces simple variables', () => {
        const template = 'Review {{mr.title}} by {{mr.author}}'
        const vars = { 'mr.title': 'Fix login', 'mr.author': 'alice' }
        expect(renderTemplate(template, vars)).toBe('Review Fix login by alice')
    })

    it('leaves unknown variables as-is', () => {
        const template = 'Title: {{mr.title}}, Unknown: {{mr.unknown}}'
        const vars = { 'mr.title': 'Fix' }
        expect(renderTemplate(template, vars)).toBe('Title: Fix, Unknown: {{mr.unknown}}')
    })

    it('handles empty values', () => {
        const template = 'Desc: {{mr.description}}'
        const vars = { 'mr.description': '' }
        expect(renderTemplate(template, vars)).toBe('Desc: ')
    })

    it('handles multiline values', () => {
        const template = 'Diff:\n{{mr.diff}}'
        const vars = { 'mr.diff': '+ added\n- removed' }
        expect(renderTemplate(template, vars)).toBe('Diff:\n+ added\n- removed')
    })

    it('handles no variables in template', () => {
        expect(renderTemplate('plain text', {})).toBe('plain text')
    })

    it('handles empty template', () => {
        expect(renderTemplate('', { 'mr.title': 'x' })).toBe('')
    })
})
