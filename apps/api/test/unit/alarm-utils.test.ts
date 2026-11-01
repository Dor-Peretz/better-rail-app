import { minutesInMs } from "./helpers/utils"
import { RideAlarm, RideAlarmStop } from "../../src/types/ride"
import { partiallyMock } from "./helpers/types"
import { LanguageCode } from "../../src/locales/i18n"
import { RouteItem } from "../../src/types/rail"
import {
  buildAlarmMovedTexts,
  buildAlarmStops,
  buildAndroidAlarmMessage,
  buildApnAlarmData,
  getAlarmFireDate,
  getAlarmMove,
} from "../../src/utils/alarm-utils"

// 2026-10-05 08:30 in Israel
const arrivalTime = Date.UTC(2026, 9, 5, 5, 30)
const transferTime = arrivalTime - minutesInMs(30)
const now = arrivalTime - minutesInMs(50)

// A transfer at Haifa Center (2300) 30 minutes before arriving at Tel Aviv - Savidor Center (3700)
const routeWithDelay = (delays: number[]) =>
  partiallyMock<RouteItem>({
    delay: delays[0],
    arrivalTime,
    trains: delays.map((delay, index) => {
      const isLast = index === delays.length - 1
      return {
        delay,
        departureTime: isLast ? transferTime + minutesInMs(5) : transferTime - minutesInMs(40),
        arrivalTime: isLast ? arrivalTime : transferTime,
        destinationStationId: isLast ? 3700 : 2300,
      }
    }),
  })

const alarm = (stops: RideAlarmStop[], secondaryLeadMinutes?: number): RideAlarm => ({
  token: "device-token",
  alarmId: "6f1c7a52-58f1-4b47-9c55-6c1d5d1d2a11",
  leadMinutes: 7,
  secondaryLeadMinutes,
  locale: LanguageCode.en,
  stops,
})

describe("arrival alarm", () => {
  it("rings the lead time before the delayed arrival of each stop's train", () => {
    const route = routeWithDelay([2, 5])
    expect(getAlarmFireDate(route, 0, 7)).toBe(transferTime + minutesInMs(2 - 7))
    expect(getAlarmFireDate(route, 1, 7)).toBe(arrivalTime + minutesInMs(5 - 7))
  })

  it("rings as the train departs when the ride on it is shorter than the lead time", () => {
    const route = routeWithDelay([0, 3])
    expect(getAlarmFireDate(route, 1, 30)).toBe(transferTime + minutesInMs(5 + 3))
  })

  it("builds a primary stop and an optional closer second warning", () => {
    expect(buildAlarmStops(routeWithDelay([0, 0]), [1], 7, 2, now)).toEqual([
      { train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(7) },
      { train: 1, phase: "secondary", fireDate: arrivalTime - minutesInMs(2) },
    ])
  })

  it("skips a second warning that would duplicate the primary", () => {
    expect(buildAlarmStops(routeWithDelay([0, 0]), [1], 2, 2, now)).toEqual([
      { train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(2) },
    ])
  })

  it("moves the stops whose delay grew or shrank", () => {
    const transfer = transferTime - minutesInMs(7)
    const destination = arrivalTime - minutesInMs(7)
    const stops: RideAlarmStop[] = [
      { train: 0, phase: "primary", fireDate: transfer },
      { train: 1, phase: "primary", fireDate: destination },
    ]

    expect(getAlarmMove(alarm(stops), routeWithDelay([0, 4]), now)).toEqual([
      { train: 0, phase: "primary", fireDate: transfer },
      { train: 1, phase: "primary", fireDate: destination + minutesInMs(4) },
    ])
    expect(
      getAlarmMove(alarm([{ train: 1, phase: "primary", fireDate: destination + minutesInMs(10) }]), routeWithDelay([0, 0]), now),
    ).toEqual([{ train: 1, phase: "primary", fireDate: destination }])
  })

  it("moves secondary warnings with their own lead time", () => {
    const stops: RideAlarmStop[] = [
      { train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(7) },
      { train: 1, phase: "secondary", fireDate: arrivalTime - minutesInMs(2) },
    ]

    expect(getAlarmMove(alarm(stops, 2), routeWithDelay([0, 4]), now)).toEqual([
      { train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(3) },
      { train: 1, phase: "secondary", fireDate: arrivalTime + minutesInMs(2) },
    ])
  })

  it("stays put for moves under a minute", () => {
    const stops: RideAlarmStop[] = [{ train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(7) + 30 * 1000 }]
    expect(getAlarmMove(alarm(stops), routeWithDelay([0, 0]), now)).toBeUndefined()
  })

  it("doesn't move a stop that already rang", () => {
    const stops: RideAlarmStop[] = [
      { train: 0, phase: "primary", fireDate: now - 1000 },
      { train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(7) },
    ]
    expect(getAlarmMove(alarm(stops), routeWithDelay([10, 0]), now)).toBeUndefined()
    expect(getAlarmMove(alarm(stops), routeWithDelay([10, 2]), now)?.[0]).toEqual(stops[0])
  })

  it("tells about the first stop that moved, in Israel's time zone", () => {
    const current = alarm([
      { train: 0, phase: "primary", fireDate: transferTime - minutesInMs(7) },
      { train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(7) },
    ])
    const moved = [current.stops[0], { train: 1, phase: "primary" as const, fireDate: arrivalTime - minutesInMs(1) }]

    const texts = buildAlarmMovedTexts(current, routeWithDelay([0, 6]), moved)
    expect(texts.title).toBe("Alarm moved to 08:29")
    expect(texts.body).toBe("It will ring 7 minutes before arriving at Tel Aviv - Savidor Center.")
  })

  it("sends iOS the stops in seconds with phase", () => {
    const stops: RideAlarmStop[] = [{ train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(3) }]
    expect(buildApnAlarmData("ride-1", alarm(stops), stops, "failed")).toEqual({
      alarm: {
        rideId: "ride-1",
        alarmId: alarm(stops).alarmId,
        stops: [{ train: 1, phase: "primary", fireDate: stops[0].fireDate / 1000 }],
        failedBody: "failed",
      },
    })
  })

  it("sends Android a data-only message that expires when the last alarm rings", () => {
    const stops: RideAlarmStop[] = [
      { train: 0, phase: "primary", fireDate: transferTime - minutesInMs(3) },
      { train: 1, phase: "primary", fireDate: arrivalTime - minutesInMs(3) },
    ]
    const texts = buildAlarmMovedTexts(alarm(stops), routeWithDelay([4, 4]), stops)
    const message = buildAndroidAlarmMessage("ride-1", alarm(stops), texts, stops, now)

    expect(message).toMatchObject({
      token: "device-token",
      data: {
        type: "arrival-alarm",
        rideId: "ride-1",
        alarmId: alarm(stops).alarmId,
        stops: JSON.stringify(stops.map(({ train, phase, fireDate }) => ({ train, phase, fireDate: fireDate / 1000 }))),
        title: texts.title,
      },
      android: { priority: "high", collapseKey: "arrival-alarm-ride-1", ttl: stops[1].fireDate - now },
    })
    expect(message).not.toHaveProperty("notification")
    expect(Object.values(message.data!).every((value) => typeof value === "string")).toBe(true)
  })
})
