import { describe, it, expect } from 'vitest'
import { parsePaste, parseCSV } from './importParse'

describe('parsePaste', () => {
  it('splits TSV when tabs present', () => {
    expect(parsePaste('a\tb\tc\n1\t2\t3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('falls back to CSV when no tab', () => {
    expect(parsePaste('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })
  it('trims cells and drops blank lines', () => {
    expect(parsePaste(' a \t b \n\n c \t d ')).toEqual([['a', 'b'], ['c', 'd']])
  })
  it('normalizes CRLF', () => {
    expect(parsePaste('a\tb\r\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('parseCSV', () => {
  it('parses plain rows', () => {
    expect(parseCSV('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('respects quoted commas', () => {
    expect(parseCSV('"x,y",z\n1,2')).toEqual([['x,y', 'z'], ['1', '2']])
  })
  it('unescapes doubled quotes inside quotes', () => {
    expect(parseCSV('"a""b",c')).toEqual([['a"b', 'c']])
  })
  it('drops fully-empty rows', () => {
    expect(parseCSV('a,b\n,\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
})
