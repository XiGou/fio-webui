import { useEffect, useMemo, useState } from 'react'
import type { Experiment, ExperimentJob } from '@/types/experiment'
import { compileExperimentToTaskList, defaultExperiment, defaultJob, defaultStage } from '@/lib/experimentCompiler'

const uid = (p: string) => `${p}-${typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Date.now()}`
const DRAFT_KEY = 'fio-webui:pipeline-draft:v1'

function readDraft(): Experiment {
  try {
    const value = localStorage.getItem(DRAFT_KEY)
    if (!value) return defaultExperiment()
    const parsed = JSON.parse(value) as Experiment
    return Array.isArray(parsed.stages) && parsed.global ? parsed : defaultExperiment()
  } catch {
    return defaultExperiment()
  }
}

export function useBuilderStore() {
  const [experiment, setExperiment] = useState<Experiment>(readDraft)
  const [selectedStageId, setSelectedStageId] = useState<string | null>(() => experiment.stages[0]?.id ?? null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(experiment))
  }, [experiment])

  const selectedStage = useMemo(() => experiment.stages.find((s) => s.id === selectedStageId) ?? null, [experiment.stages, selectedStageId])
  const selectedJob = useMemo(() => selectedStage?.jobs.find((j) => j.id === selectedJobId) ?? null, [selectedStage, selectedJobId])

  const addStage = () => {
    const stage = { ...defaultStage(), id: uid('stage'), name: `节点 ${experiment.stages.length + 1}` }
    setExperiment((prev) => ({ ...prev, stages: [...prev.stages, stage] }))
    setSelectedStageId(stage.id)
    setSelectedJobId(null)
  }

  const updateStage = (stageId: string, patch: Partial<Experiment['stages'][number]>) => {
    setExperiment((prev) => ({ ...prev, stages: prev.stages.map((stage) => (stage.id === stageId ? { ...stage, ...patch } : stage)) }))
  }

  const removeStage = (stageId: string) => {
    setExperiment((prev) => ({ ...prev, stages: prev.stages.filter((stage) => stage.id !== stageId) }))
    if (selectedStageId === stageId) {
      setSelectedStageId(null)
      setSelectedJobId(null)
    }
  }

  const addJob = (stageId: string, preset?: Partial<ExperimentJob>) => {
    const base = defaultJob()
    const job = {
      ...base,
      ...preset,
      id: uid('job'),
      overrides: { ...base.overrides, ...preset?.overrides },
    }
    setExperiment((prev) => ({ ...prev, stages: prev.stages.map((stage) => (stage.id === stageId ? { ...stage, jobs: [...stage.jobs, job] } : stage)) }))
    setSelectedStageId(stageId)
    setSelectedJobId(job.id)
  }

  const updateJob = (stageId: string, jobId: string, patch: Partial<ExperimentJob>) => {
    setExperiment((prev) => ({
      ...prev,
      stages: prev.stages.map((stage) =>
        stage.id === stageId ? { ...stage, jobs: stage.jobs.map((job) => (job.id === jobId ? { ...job, ...patch } : job)) } : stage,
      ),
    }))
  }

  const removeJob = (stageId: string, jobId: string) => {
    setExperiment((prev) => ({
      ...prev,
      stages: prev.stages.map((stage) => (stage.id === stageId ? { ...stage, jobs: stage.jobs.filter((job) => job.id !== jobId) } : stage)),
    }))
    if (selectedJobId === jobId) setSelectedJobId(null)
  }

  const moveStage = (stageId: string, direction: -1 | 1) => {
    setExperiment((prev) => {
      const index = prev.stages.findIndex((stage) => stage.id === stageId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.stages.length) return prev
      const stages = [...prev.stages]
      const [stage] = stages.splice(index, 1)
      stages.splice(nextIndex, 0, stage)
      return { ...prev, stages }
    })
  }

  const replaceExperiment = (next: Experiment) => {
    setExperiment(next)
    setSelectedStageId(next.stages[0]?.id ?? null)
    setSelectedJobId(null)
  }

  const compileResult = useMemo(() => compileExperimentToTaskList(experiment), [experiment])

  return {
    experiment,
    setExperiment,
    selectedStage,
    selectedJob,
    selectedStageId,
    selectedJobId,
    setSelectedStageId,
    setSelectedJobId,
    addStage,
    updateStage,
    removeStage,
    addJob,
    updateJob,
    removeJob,
    moveStage,
    replaceExperiment,
    compileResult,
  }
}
