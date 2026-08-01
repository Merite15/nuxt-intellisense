import * as assert from 'assert';
import { TextUtils } from '../../utils/textUtils';
import { Location, Position, Range, Uri } from '../mocks/vscode';

describe('TextUtils', () => {
    describe('indexToPosition', () => {
        it('resolves a position on the first line', () => {
            const content = 'const foo = 1;';
            const pos = TextUtils.indexToPosition(content, 6);
            assert.deepStrictEqual(pos, { line: 0, character: 6 });
        });

        it('resolves a position after a newline', () => {
            const content = 'line one\nline two\nline three';
            const index = content.indexOf('two');
            const pos = TextUtils.indexToPosition(content, index);
            assert.deepStrictEqual(pos, { line: 1, character: 5 });
        });
    });

    describe('isInsideStringLiteral', () => {
        it('detects a position inside a double-quoted string', () => {
            const content = 'const message = "use const here";';
            const index = content.indexOf('const here');
            assert.strictEqual(TextUtils.isInsideStringLiteral(content, index), true);
        });

        it('detects a position inside a single-quoted string', () => {
            const content = "const message = 'search carefully';";
            const index = content.indexOf('search');
            assert.strictEqual(TextUtils.isInsideStringLiteral(content, index), true);
        });

        it('detects a position inside a template literal', () => {
            const content = 'const message = `please search here`;';
            const index = content.indexOf('search');
            assert.strictEqual(TextUtils.isInsideStringLiteral(content, index), true);
        });

        it('returns false for a position outside any string', () => {
            const content = 'const search = getSearch();';
            const index = content.indexOf('search');
            assert.strictEqual(TextUtils.isInsideStringLiteral(content, index), false);
        });

        it('ignores escaped quotes when scanning', () => {
            const content = 'const message = "he said \\"const\\" nothing else"; const real = 1;';
            const index = content.indexOf('real');
            assert.strictEqual(TextUtils.isInsideStringLiteral(content, index), false);
        });
    });

    describe('removeDuplicateReferences', () => {
        it('removes references pointing to the exact same location', () => {
            const uri = Uri.file('/project/pages/index.vue');
            const range = new Range(new Position(2, 4), new Position(2, 10));

            const references = [
                new Location(uri, range),
                new Location(uri, range),
                new Location(uri, new Range(new Position(5, 0), new Position(5, 6)))
            ];

            const unique = TextUtils.removeDuplicateReferences(references as any);
            assert.strictEqual(unique.length, 2);
        });
    });
});
