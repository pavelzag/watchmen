import { cn } from './utils';

describe('utils cn()', () => {
    it('merges tailwind classes correctly', () => {
        expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white');
    });

    it('handles conditional classes properly', () => {
        const isActive = true;
        const isDisabled = false;
        expect(cn('base-class', isActive && 'active-class', isDisabled && 'disabled-class')).toBe('base-class active-class');
    });

    it('resolves tailwind conflicts using tailwind-merge', () => {
        // text-white should override text-black
        expect(cn('text-black px-2 py-1', 'text-white')).toBe('px-2 py-1 text-white');
    });

    it('handles arrays and objects', () => {
        expect(cn(['bg-blue-500', 'p-4'], { 'text-bold': true, 'text-italic': false })).toBe('bg-blue-500 p-4 text-bold');
    });
});
