import type { FcmMessage } from "../push/fcm"

import { RouteItem } from "../types/rail"
import { ArrivalAlarmPhase, RideAlarm, RideAlarmStop } from "../types/ride"
import { stationsObject } from "../data/stations"
import { LanguageCode, railApiLocales, translate } from "../locales/i18n"

// Smaller moves aren't worth a notification.
const MIN_ALARM_MOVE_MS = 60 * 1000

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jerusalem",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** When a stop's alarm should ring: `leadMinutes` before its train's actual (delayed) arrival, in ms */
export const getAlarmFireDate = (route: RouteItem, train: number, leadMinutes: number) => {
  const { arrivalTime, departureTime, delay } = route.trains[train]
  // A train ride shorter than the lead time rings as it departs, not at the stop before.
  return Math.max(arrivalTime - leadMinutes * 60 * 1000, departureTime) + delay * 60 * 1000
}

const leadMinutesForPhase = (alarm: RideAlarm, phase: ArrivalAlarmPhase = "primary") =>
  phase === "secondary" ? (alarm.secondaryLeadMinutes ?? alarm.leadMinutes) : alarm.leadMinutes

/**
 * Builds primary (and optional secondary) fire dates for the chosen trains.
 * Skips a secondary that would duplicate or precede the primary.
 */
export const buildAlarmStops = (
  route: RouteItem,
  trains: number[],
  leadMinutes: number,
  secondaryLeadMinutes?: number,
  now = Date.now(),
): RideAlarmStop[] => {
  const stops: RideAlarmStop[] = []

  for (const train of trains) {
    if (!route.trains[train]) continue

    const primaryFire = getAlarmFireDate(route, train, leadMinutes)
    if (primaryFire > now) {
      stops.push({ train, phase: "primary", fireDate: primaryFire })
    }

    if (secondaryLeadMinutes == null || leadMinutes <= secondaryLeadMinutes) continue

    const secondaryFire = getAlarmFireDate(route, train, secondaryLeadMinutes)
    if (secondaryFire > now && secondaryFire > primaryFire) {
      stops.push({ train, phase: "secondary", fireDate: secondaryFire })
    }
  }

  return stops
}

/** The stops with the fire dates to move the device's alarms to, or undefined when they should stay put */
export const getAlarmMove = (alarm: RideAlarm, route: RouteItem, now: number) => {
  let moved = false
  const stops = alarm.stops.map((stop) => {
    // It already rang, and moving it would make it ring again.
    if (stop.fireDate <= now || !route.trains[stop.train]) return stop

    const fireDate = getAlarmFireDate(route, stop.train, leadMinutesForPhase(alarm, stop.phase ?? "primary"))
    if (Math.abs(fireDate - stop.fireDate) < MIN_ALARM_MOVE_MS) return stop

    moved = true
    return { ...stop, phase: stop.phase ?? "primary", fireDate }
  })

  return moved ? stops : undefined
}

/** Fire dates in seconds, as the devices take them */
const pushStops = (stops: RideAlarmStop[]) =>
  stops.map(({ train, phase, fireDate }) => ({
    train,
    phase: phase ?? "primary",
    fireDate: Math.floor(fireDate / 1000),
  }))

export const buildApnAlarmData = (rideId: string, alarm: RideAlarm, stops: RideAlarmStop[], failedBody: string) => ({
  alarm: { rideId, alarmId: alarm.alarmId, stops: pushStops(stops), failedBody },
})

const stationName = (stationId: number, locale: LanguageCode) => {
  const station = stationsObject[stationId]
  if (!station) return ""
  return station[railApiLocales[locale].toLowerCase() as "hebrew" | "english" | "russian" | "arabic"]
}

/**
 * A data-only FCM message: it wakes the app's background task, which moves the alarm and shows the texts.
 * FCM data values must be strings.
 */
export const buildAndroidAlarmMessage = (
  rideId: string,
  alarm: RideAlarm,
  texts: ReturnType<typeof buildAlarmMovedTexts>,
  stops: RideAlarmStop[],
  now: number,
): FcmMessage => ({
  token: alarm.token,
  data: {
    type: "arrival-alarm",
    rideId,
    alarmId: alarm.alarmId,
    stops: JSON.stringify(pushStops(stops)),
    title: texts.title,
    body: texts.body,
    failedBody: texts.failedBody,
  },
  android: {
    priority: "high",
    // Only the latest move matters, and none does once the last alarm rang.
    collapseKey: `arrival-alarm-${rideId}`,
    ttl: Math.max(0, Math.max(...stops.map((stop) => stop.fireDate)) - now),
  },
})

/** Tells about the first stop whose alarm moved */
export const buildAlarmMovedTexts = (alarm: RideAlarm, route: RouteItem, stops: RideAlarmStop[]) => {
  const moved = stops.find((stop, index) => stop.fireDate !== alarm.stops[index]?.fireDate) ?? stops[0]
  const stationId = route.trains[moved.train]?.destinationStationId ?? 0
  const time = clockFormatter.format(moved.fireDate)
  const minutes = leadMinutesForPhase(alarm, moved.phase ?? "primary")

  return {
    title: translate("notifications.alarm.moved.title", alarm.locale, { time }),
    body: translate("notifications.alarm.moved.description", alarm.locale, {
      minutes,
      station: stationName(stationId, alarm.locale),
    }),
    // Shown instead when the device couldn't move the alarm.
    failedBody: translate("notifications.alarm.failed", alarm.locale),
  }
}
