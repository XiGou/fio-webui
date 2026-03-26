import { useMemo, useState } from 'react'
import type { Experiment, ExperimentJob } from '@/types/experiment'
import { compileExperimentToTaskList, defaultExperiment, defaultJob, defaultStage } from '@/lib/experimentCompiler'

const uid = (p: string) => `${p}-${typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : Date.now()}`

export function useBuilderStore() {
  const [experiment, setExperiment] = useState<Experiment>(() => defaultExperiment())
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const selectedStage = useMemo(() => experiment.stages.find((s) => s.id === selectedStageId) ?? null, [experiment.stages, selectedStageId])
  const selectedJob = useMemo(() => selectedStage?.jobs.find((j) => j.id === selectedJobId) ?? null, [selectedStage, selectedJobId])

  const addStage = () => {
    const stage = { ...defaultStage(), id: uid('stage'), name: `Stage ${experiment.stages.length + 1}` }
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

  const addJob = (stageId: string) => {
    const job = { ...defaultJob(), id: uid('job') }
    setExperiment((prev) => ({ ...prev, stages: prev.stages.map((stage) => (stage.id === stageId ? { ...stage, jobs: [...stage.jobs, job] } : stage)) }))
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
    compileResult,
  }
}
