import { MPM } from '../../../mpm-ts/lib'
import type { Tempo, Scope } from '../../../mpm-ts/lib'
import { MSM, AbstractTransformer, generateId } from 'mpmify'
import type { ScopedTransformationOptions } from 'mpmify'

interface InsertTempoOptions extends ScopedTransformationOptions {
    from: number
    to: number
    bpm: number
    transitionTo?: number
    meanTempoAt?: number
    beatLength: number
}

export class InsertTempo extends AbstractTransformer<InsertTempoOptions> {
    readonly name = 'InsertTempo'
    readonly requires = []
    private _boundaryId?: string

    constructor(options?: InsertTempoOptions) {
        super()
        if (options) {
            this.options = options
            this.argumentation = {
                id: this.id,
                type: 'simpleArgumentation',
                conclusion: {
                    id: this.id,
                    motivation: 'move',
                    certainty: 'authentic'
                }
            }
        }
    }

    public run(msm: MSM, mpm: MPM) {
        this._boundaryId = undefined
        super.run(msm, mpm)
        if (this._boundaryId) {
            this.created = this.created.filter(id => id !== this._boundaryId)
        }
    }

    protected transform(_msm: MSM, mpm: MPM) {
        const { from, to, bpm, transitionTo, meanTempoAt, beatLength } = this.options
        const scope = this.options.scope

        this.removeAffectedTempoInstructions(mpm, scope, from, to)

        const tempo: Tempo = {
            type: 'tempo',
            'xml:id': generateId('tempo', from, mpm),
            date: from,
            bpm,
            beatLength,
            ...(transitionTo !== undefined ? {
                'transition.to': transitionTo,
                meanTempoAt: meanTempoAt ?? 0.5
            } : {})
        }

        mpm.insertInstruction(tempo, scope, true)
    }

    private removeAffectedTempoInstructions(mpm: MPM, scope: Scope, from: number, to: number) {
        const existing = mpm.getInstructions<Tempo>('tempo', scope)
            .slice()
            .sort((a, b) => a.date - b.date)
        if (existing.length === 0) return

        const isCovered = (date: number) => date >= from && date < to

        const boundary = to
        if (!existing.some(t => t.date === boundary)) {
            const effectiveIndex = findEffectiveTempoIndex(existing, boundary)
            if (effectiveIndex !== -1) {
                const effectiveTempo = existing[effectiveIndex]
                if (isCovered(effectiveTempo.date)) {
                    const restore: Tempo = {
                        type: 'tempo',
                        'xml:id': generateId('tempo', boundary, mpm),
                        date: boundary,
                        beatLength: effectiveTempo.beatLength,
                        bpm: effectiveTempo.bpm
                    }
                    this._boundaryId = restore['xml:id']
                    for (const t of existing) {
                        if (isCovered(t.date)) mpm.removeInstruction(t)
                    }
                    mpm.insertInstruction(restore, scope, false)
                    return
                }
            }
        }

        for (const t of existing) {
            if (isCovered(t.date)) mpm.removeInstruction(t)
        }
    }
}

function findEffectiveTempoIndex(tempos: Tempo[], date: number): number {
    let result = -1
    for (let i = 0; i < tempos.length; i++) {
        if (tempos[i].date <= date) result = i
        else break
    }
    return result
}
