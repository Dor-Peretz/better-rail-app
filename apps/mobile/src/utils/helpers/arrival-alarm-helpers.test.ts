import { test, expect } from "bun:test"
import { buildRoute, MINUTE } from "../../../test/fixtures/ride-route"
import {
  ARRIVAL_ALARM_SECONDARY_LEAD_MINUTES,
  buildArrivalAlarmStops,
  getArrivalAlarmFireDate,
  getArrivalAlarmStops,
  getNextArrivalAlarmStop,
  getNextStopTrain,
  hasArrivalAlarmTrainRang,
  toggleArrivalAlarmStop,
} from "./arrival-alarm-helpers"

test("rings the lead time before each stop's delayed arrival", () => {
  const route = buildRoute(10 * MINUTE)
  route.trains[1].delay = 3

  expect(getArrivalAlarmFireDate(route, 0, 5)).toBe(route.trains[0].arrivalTime - 5 * MINUTE)
  expect(getArrivalAlarmFireDate(route, 1, 5)).toBe(route.trains[1].arrivalTime - 2 * MINUTE)
})

test("rings as the train departs when the ride on it is shorter than the lead time", () => {
  const route = buildRoute(10 * MINUTE)

  expect(getArrivalAlarmFireDate(route, 1, 30)).toBe(route.trains[1].departureTime)
})

test("defaults to the next stop the rider gets off", () => {
  // On the first train
  expect(getArrivalAlarmStops(buildRoute(-10 * MINUTE), undefined)).toEqual([0])
  // On the second train
  expect(getArrivalAlarmStops(buildRoute(-35 * MINUTE), undefined)).toEqual([1])
  // Arrived
  expect(getArrivalAlarmStops(buildRoute(-2 * 60 * MINUTE), undefined)).toEqual([])
  expect(getNextStopTrain(buildRoute(-2 * 60 * MINUTE))).toBe(-1)
})

test("keeps the rider's choice while it has a stop ahead", () => {
  expect(getArrivalAlarmStops(buildRoute(-10 * MINUTE), [0, 1])).toEqual([0, 1])
  expect(getArrivalAlarmStops(buildRoute(-35 * MINUTE), [0, 1])).toEqual([1])
  // Only the passed transfer was chosen
  expect(getArrivalAlarmStops(buildRoute(-35 * MINUTE), [0])).toEqual([1])
})

test("follows the delay when telling a passed stop", () => {
  const route = buildRoute(-35 * MINUTE)
  route.trains[0].delay = 10

  expect(getNextStopTrain(route)).toBe(0)
})

test("checks and unchecks stops, but never the last one", () => {
  expect(toggleArrivalAlarmStop([1], 0)).toEqual([0, 1])
  expect(toggleArrivalAlarmStop([0, 1], 1)).toEqual([0])
  expect(toggleArrivalAlarmStop([0], 0)).toBeUndefined()
})

test("shows the stop that rings next", () => {
  const now = Date.now()
  const stops = [
    { train: 0, fireDate: now - MINUTE, phase: "primary" as const },
    { train: 1, fireDate: now + 20 * MINUTE, phase: "primary" as const },
  ]

  expect(getNextArrivalAlarmStop(stops, now)).toBe(stops[1])
  expect(getNextArrivalAlarmStop(stops, now + 30 * MINUTE)).toBe(stops[1])
})

test("builds a primary stop and an optional closer second warning", () => {
  const route = buildRoute(10 * MINUTE)
  const now = route.trains[1].arrivalTime - 20 * MINUTE

  expect(buildArrivalAlarmStops(route, [1], 5, { now })).toEqual([
    { train: 1, fireDate: route.trains[1].arrivalTime - 5 * MINUTE, phase: "primary" },
  ])

  expect(buildArrivalAlarmStops(route, [1], 5, { now, secondaryLeadMinutes: ARRIVAL_ALARM_SECONDARY_LEAD_MINUTES })).toEqual([
    { train: 1, fireDate: route.trains[1].arrivalTime - 5 * MINUTE, phase: "primary" },
    { train: 1, fireDate: route.trains[1].arrivalTime - 2 * MINUTE, phase: "secondary" },
  ])
})

test("skips a second warning that would duplicate or precede the primary", () => {
  const route = buildRoute(10 * MINUTE)
  const now = route.trains[1].departureTime - 5 * MINUTE

  expect(buildArrivalAlarmStops(route, [1], 2, { now, secondaryLeadMinutes: 2 })).toEqual([
    { train: 1, fireDate: route.trains[1].arrivalTime - 2 * MINUTE, phase: "primary" },
  ])
  expect(buildArrivalAlarmStops(route, [1], 1, { now, secondaryLeadMinutes: 2 })).toEqual([
    { train: 1, fireDate: route.trains[1].arrivalTime - 1 * MINUTE, phase: "primary" },
  ])

  // Both phases clamp to the same departure when the ride is shorter than either lead time.
  expect(buildArrivalAlarmStops(route, [1], 30, { now, secondaryLeadMinutes: 25 })).toEqual([
    { train: 1, fireDate: route.trains[1].departureTime, phase: "primary" },
  ])
})

test("drops past primary rings but keeps a still-future second warning", () => {
  const route = buildRoute(10 * MINUTE)
  const now = route.trains[1].arrivalTime - 3 * MINUTE

  expect(buildArrivalAlarmStops(route, [1], 5, { now, secondaryLeadMinutes: 2 })).toEqual([
    { train: 1, fireDate: route.trains[1].arrivalTime - 2 * MINUTE, phase: "secondary" },
  ])
})

test("handles a journey that crosses midnight", () => {
  const route = buildRoute(10 * MINUTE)
  // Push arrivals across midnight relative to "now".
  const midnight = Date.UTC(2026, 10, 2, 0, 0, 0)
  const offset = midnight - route.trains[1].arrivalTime
  for (const train of route.trains) {
    train.departureTime += offset
    train.arrivalTime += offset
  }
  const now = route.trains[1].arrivalTime - 8 * MINUTE

  expect(buildArrivalAlarmStops(route, [1], 5, { now })[0]?.fireDate).toBe(route.trains[1].arrivalTime - 5 * MINUTE)
})

test("detects whether any phase of a train has rang", () => {
  expect(hasArrivalAlarmTrainRang(["1:primary"], 1)).toBe(true)
  expect(hasArrivalAlarmTrainRang(["1:secondary"], 1)).toBe(true)
  expect(hasArrivalAlarmTrainRang(["0:primary"], 1)).toBe(false)
})
