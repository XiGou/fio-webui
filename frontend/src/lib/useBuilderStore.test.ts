import { describe, expect, it } from 'vitest'
import type { ExperimentStage } from '@/types/experiment'
import { insertStageAfter } from './useBuilderStore'

const stage = (id: string): ExperimentStage => ({ id, name: id, shared: {}, jobs: [] })

describe('insertStageAfter', () => {
  it('inserts a new node directly after the selected node', () => {
    const result = insertStageAfter([stage('a'), stage('b'), stage('c')], stage('new'), 'b')

    expect(result.map((item) => item.id)).toEqual(['a', 'b', 'new', 'c'])
  })

  it('appends when there is no valid insertion target', () => {
    const stages = [stage('a'), stage('b')]

    expect(insertStageAfter(stages, stage('end')).map((item) => item.id)).toEqual(['a', 'b', 'end'])
    expect(insertStageAfter(stages, stage('missing'), 'unknown').map((item) => item.id)).toEqual(['a', 'b', 'missing'])
  })
})
