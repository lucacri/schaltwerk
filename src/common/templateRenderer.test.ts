import { describe, it, expect } from 'vitest'
import { renderTemplate } from './templateRenderer'

describe('renderTemplate', () => {
    it('replaces simple variables', () => {
        const template = 'Review {{pr.title}} by {{pr.author}}'
        const vars = { 'pr.title': 'Fix login', 'pr.author': 'alice' }
        expect(renderTemplate(template, vars)).toBe('Review Fix login by alice')
    })

    it('leaves unknown variables as-is', () => {
        const template = 'Title: {{pr.title}}, Unknown: {{pr.unknown}}'
        const vars = { 'pr.title': 'Fix' }
        expect(renderTemplate(template, vars)).toBe('Title: Fix, Unknown: {{pr.unknown}}')
    })

    it('handles empty values', () => {
        const template = 'Desc: {{pr.description}}'
        const vars = { 'pr.description': '' }
        expect(renderTemplate(template, vars)).toBe('Desc: ')
    })

    it('handles multiline values', () => {
        const template = 'Diff:\n{{pr.diff}}'
        const vars = { 'pr.diff': '+ added\n- removed' }
        expect(renderTemplate(template, vars)).toBe('Diff:\n+ added\n- removed')
    })

    it('handles no variables in template', () => {
        expect(renderTemplate('plain text', {})).toBe('plain text')
    })

    it('handles empty template', () => {
        expect(renderTemplate('', { 'pr.title': 'x' })).toBe('')
    })
})
