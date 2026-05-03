import { describe, it, expect, vi } from 'vitest';
import { detectPlatformSafe } from '../../keyboardShortcuts/helpers';
import {
    matchKeybinding,
    shouldSkipShell,
    shouldHandleClaudeShiftEnter,
    TerminalCommand,
    shouldEmitControlPaste,
    shouldEmitControlNewline,
} from './terminalKeybindings';

vi.mock('../../keyboardShortcuts/helpers', () => ({
    detectPlatformSafe: vi.fn(() => 'mac'),
}));

describe('terminalKeybindings', () => {
    describe('matchKeybinding', () => {
        // Phase 8 W.2/W.6 follow-through: NewSession + NewSpec collapsed
        // into NewTask. Both shortcuts route to the same NewTaskModal.
        // Mirrors smoke checklist §A.3 ("Open NewTask modal via either
        // Mod+N or Mod+Shift+N from terminal-focused context"). If the
        // collapse regresses, this test fails before the user walks.
        it('should match Cmd+N as NewTask on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'N',
                metaKey: true,
                shiftKey: false,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.NewTask);
        });

        it('should match Cmd+Shift+N as NewTask on Mac (collapsed from NewSpec in W.2)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'N',
                metaKey: true,
                shiftKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.NewTask);
        });

        it('should also match the lowercase n key for both shortcuts', () => {
            const plain = new KeyboardEvent('keydown', {
                key: 'n',
                metaKey: true,
                shiftKey: false,
            });
            const shifted = new KeyboardEvent('keydown', {
                key: 'n',
                metaKey: true,
                shiftKey: true,
            });
            expect(matchKeybinding(plain).commandId).toBe(TerminalCommand.NewTask);
            expect(matchKeybinding(shifted).commandId).toBe(TerminalCommand.NewTask);
        });

        it('should match Cmd+R as MarkReady on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'R',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.MarkReady);
        });

        it('should match Cmd+F as Search on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'F',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.Search);
        });

        it('should match Cmd+Enter as NewLine on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.NewLine);
        });

        it('should NOT match Cmd+C (allow it to pass through)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(false);
            expect(result.commandId).toBeUndefined();
        });

        it('should NOT match Ctrl+C (allow it to pass through)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
                ctrlKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(false);
            expect(result.commandId).toBeUndefined();
        });

        it('should NOT match plain C key', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(false);
            expect(result.commandId).toBeUndefined();
        });
    });

    describe('codex control shortcuts', () => {
        beforeEach(() => {
            vi.mocked(detectPlatformSafe).mockReturnValue('mac');
        });

        it('should emit control paste sequence for Ctrl+V on macOS', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'v',
                ctrlKey: true,
            });
            expect(shouldEmitControlPaste(event)).toBe(true);
        });

        it('should not emit control paste when Command key is used', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'v',
                metaKey: true,
            });
            expect(shouldEmitControlPaste(event)).toBe(false);
        });

        it('should emit newline control sequence for Ctrl+J on macOS', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'j',
                ctrlKey: true,
            });
            expect(shouldEmitControlNewline(event)).toBe(true);
        });

        it('should ignore Ctrl+J when additional modifiers are present', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'j',
                ctrlKey: true,
                shiftKey: true,
            });
            expect(shouldEmitControlNewline(event)).toBe(false);
        });
    });

    describe('shouldSkipShell', () => {
        it('should return true for commands in skip list', () => {
            expect(shouldSkipShell(TerminalCommand.NewTask)).toBe(true);
            expect(shouldSkipShell(TerminalCommand.MarkReady)).toBe(true);
            expect(shouldSkipShell(TerminalCommand.Search)).toBe(true);
            expect(shouldSkipShell(TerminalCommand.NewLine)).toBe(true);
        });

        it('should return false for undefined command', () => {
            expect(shouldSkipShell(undefined)).toBe(false);
        });

        it('should return false for unknown command', () => {
            expect(shouldSkipShell('unknown.command' as TerminalCommand)).toBe(false);
        });
    });

    describe('shouldHandleClaudeShiftEnter', () => {
        it('should return true for Claude agent with Shift+Enter', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', true, false);
            expect(result).toBe(true);
        });

        it('should return false if not Claude agent', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'codex', true, false);
            expect(result).toBe(false);
        });

        it('should return false if not top terminal', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', false, false);
            expect(result).toBe(false);
        });

        it('should return false if terminal is read-only', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', true, true);
            expect(result).toBe(false);
        });

        it('should return false if Cmd/Ctrl key is pressed', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'Enter',
                shiftKey: true,
                metaKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', true, false);
            expect(result).toBe(false);
        });

        it('should return false if not Enter key', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'A',
                shiftKey: true,
            });
            const result = shouldHandleClaudeShiftEnter(event, 'claude', true, false);
            expect(result).toBe(false);
        });
    });

    describe('project switching keybindings', () => {
        it('should match Cmd+Shift+1 as SwitchProject on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: '1',
                metaKey: true,
                shiftKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.SwitchProject);
        });

        it('should match Cmd+Shift+9 as SwitchProject on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: '9',
                metaKey: true,
                shiftKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.SwitchProject);
        });

        it('should match Cmd+` as CycleNextProject on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: '`',
                metaKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.CycleNextProject);
        });

        it('should skip shell for SwitchProject', () => {
            expect(shouldSkipShell(TerminalCommand.SwitchProject)).toBe(true);
        });

        it('should skip shell for CycleNextProject', () => {
            expect(shouldSkipShell(TerminalCommand.CycleNextProject)).toBe(true);
        });

        it('should match Cmd+Shift+` as CyclePrevProject on Mac', () => {
            const event = new KeyboardEvent('keydown', {
                key: '~',
                metaKey: true,
                shiftKey: true,
            });
            const result = matchKeybinding(event);
            expect(result.matches).toBe(true);
            expect(result.commandId).toBe(TerminalCommand.CyclePrevProject);
        });

        it('should skip shell for CyclePrevProject', () => {
            expect(shouldSkipShell(TerminalCommand.CyclePrevProject)).toBe(true);
        });
    });

    describe('Ctrl+C behavior (critical for TUI compatibility)', () => {
        it('should allow Ctrl+C to pass through to xterm (not in skip list)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
                ctrlKey: true,
            });
            const match = matchKeybinding(event);
            expect(match.matches).toBe(false);
            expect(shouldSkipShell(match.commandId)).toBe(false);
        });

        it('should allow Cmd+C to pass through to xterm on Mac (not in skip list)', () => {
            const event = new KeyboardEvent('keydown', {
                key: 'c',
                metaKey: true,
            });
            const match = matchKeybinding(event);
            expect(match.matches).toBe(false);
            expect(shouldSkipShell(match.commandId)).toBe(false);
        });
    });
});
