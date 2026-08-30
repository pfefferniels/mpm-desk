export type ScoreEvent = {
    type: 'rest' | 'note' | 'sustain' | 'soft',
    tstamp: number,
    id: string
    pitch?: number
}
