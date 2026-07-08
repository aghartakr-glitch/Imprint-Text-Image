import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DESIGN_SPACE } from './designSpace.js'

test('DESIGN_SPACE exposes every vocabulary list the spec requires', () => {
  const keys = [
    'outputUnits', 'layoutFamilies', 'layoutPurposes', 'imageHierarchies', 'imageRoles',
    'textRoles', 'imageTextRelations', 'compositionStrategies', 'objectPositions',
  ]
  keys.forEach((k) => {
    assert.ok(Array.isArray(DESIGN_SPACE[k]) && DESIGN_SPACE[k].length > 0, `DESIGN_SPACE.${k} should be a non-empty array`)
  })
  assert.deepEqual(DESIGN_SPACE.outputUnits, ['single_page', 'spread'])
  assert.ok(DESIGN_SPACE.objectPositions.includes('center'))
})
