import { useEffect, useState } from "react"
import { Platform, View } from "react-native"
import { StyleSheet } from "react-native-unistyles"
import { Screen, Text } from "@/components"
import { SettingBox } from "./components/settings-box"
import { translate } from "@/i18n"
import { settingsStyles } from "./settings-styles"
import { useShallow } from "zustand/react/shallow"
import { ARRIVAL_ALARM_LEAD_MINUTE_OPTIONS, type ArrivalAlarmLeadMinutes, useSettingsStore } from "@/models/settings/settings"
import {
  arrivalAlarmAuthorization,
  isArrivalAlarmSupported,
  openArrivalAlarmSettings,
  type ArrivalAlarmAuthorization,
} from "@/utils/arrival-alarm-native"

export function ArrivalAlarmSettingsScreen() {
  const {
    arrivalAlarmLeadMinutes,
    setArrivalAlarmLeadMinutes,
    arrivalAlarmSecondWarningEnabled,
    setArrivalAlarmSecondWarningEnabled,
  } = useSettingsStore(
    useShallow((s) => ({
      arrivalAlarmLeadMinutes: s.arrivalAlarmLeadMinutes,
      setArrivalAlarmLeadMinutes: s.setArrivalAlarmLeadMinutes,
      arrivalAlarmSecondWarningEnabled: s.arrivalAlarmSecondWarningEnabled,
      setArrivalAlarmSecondWarningEnabled: s.setArrivalAlarmSecondWarningEnabled,
    })),
  )

  const supported = isArrivalAlarmSupported()
  const [authorization, setAuthorization] = useState<ArrivalAlarmAuthorization>("notDetermined")

  useEffect(() => {
    if (!supported) return
    arrivalAlarmAuthorization().then(setAuthorization)
  }, [supported])

  return (
    <Screen
      testID="arrival-alarm-settings-screen"
      style={styles.root}
      preset="scroll"
      unsafe={true}
      statusBar={Platform.select({ ios: "light-content" })}
    >
      {!supported ? (
        <View style={settingsStyles.group}>
          <SettingBox first last title={translate("settings.arrivalAlarmUnsupported") ?? ""} />
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>{translate("settings.arrivalAlarmDefaultLead")}</Text>
          <View style={settingsStyles.group}>
            {ARRIVAL_ALARM_LEAD_MINUTE_OPTIONS.map((minutes, index) => (
              <SettingBox
                key={minutes}
                testID={`arrival-alarm-lead-${minutes}`}
                first={index === 0}
                last={index === ARRIVAL_ALARM_LEAD_MINUTE_OPTIONS.length - 1}
                title={translate("ride.alarmLeadOption", { minutes }) ?? ""}
                checkmark={arrivalAlarmLeadMinutes === minutes}
                onPress={() => setArrivalAlarmLeadMinutes(minutes as ArrivalAlarmLeadMinutes)}
              />
            ))}
          </View>

          <View style={settingsStyles.group}>
            <SettingBox
              testID="arrival-alarm-second-warning"
              first
              last
              title={translate("settings.arrivalAlarmSecondWarning") ?? ""}
              toggle
              toggleValue={arrivalAlarmSecondWarningEnabled}
              onToggle={setArrivalAlarmSecondWarningEnabled}
            />
          </View>
          <Text style={styles.hint}>{translate("settings.arrivalAlarmSecondWarningDescription")}</Text>

          <View style={settingsStyles.group}>
            <SettingBox
              testID="arrival-alarm-permissions"
              first
              last
              title={translate("settings.arrivalAlarmPermissions") ?? ""}
              chevron
              onPress={() => openArrivalAlarmSettings("permissions")}
            />
          </View>
          <Text style={styles.hint}>
            {translate("settings.arrivalAlarmPermissionsDescription")}
            {authorization === "denied" ? ` (${translate("ride.alarmDeniedTitle")})` : ""}
          </Text>
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    paddingTop: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  sectionLabel: {
    marginBottom: theme.spacing[2],
    marginStart: theme.spacing[1],
    fontSize: 13,
    color: theme.colors.dim,
  },
  hint: {
    marginTop: -theme.spacing[2],
    marginBottom: theme.spacing[4],
    marginHorizontal: theme.spacing[1],
    fontSize: 13,
    color: theme.colors.dim,
  },
}))
