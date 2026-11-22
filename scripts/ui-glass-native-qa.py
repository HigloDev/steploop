#!/usr/bin/env python3
"""Capture the real Android screens in the isolated Steploop UI QA package."""

import argparse
import io
import json
import os
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from contextlib import contextmanager, nullcontext
from pathlib import Path

from PIL import Image

PACKAGE = "com.zxn.palou.uiqa"
CORE = {
    "home": ("开始爬楼", "继续训练"),
    "climbing": ("正在向上", "确认结束训练"),
    "summary": ("训练完成", "本次成绩"),
    "coach": ("选择课程", "今日课程", "门课程", "课程目录"),
    "history": ("训练记录",),
    "settings": ("外观",),
}
SUPPORT = {
    "appearance": ("显示模式",),
    "privacy-first": ("隐私协议", "隐私政策", "隐私说明"),
    "onboarding": ("向上", "跳过", "循阶"),
    "coach-course": ("目标体重管理",),
    "coach-goal": ("目标体重",),
    "coach-session": ("有效上爬", "开始这次课程", "课程安排"),
    "coach-records": ("体重", "复盘", "教练记录"),
    "coach-review": ("复盘",),
    "share": ("成果预览", "分享"),
    "weekly": ("本周成果分享",),
    "legacy": ("训练", "单轮"),
    "diagnostic": ("采集", "诊断"),
}
STATES = {
    "calibrating": ("标定",),
    "calibration_top": ("标定", "到顶", "折返"),
    "descending": ("乘电梯", "下行中", "到楼下自动开始下一轮"),
    "waiting": ("在楼下准备", "下一轮", "等待"),
    "save-failed": ("保存失败", "重试保存"),
    "history-empty": ("训练记录", "暂无"),
}


class Lab:
    def __init__(self, serial, out, phone_model=None, expected_version=None):
        self.physical = not re.fullmatch(r"emulator-\d+", serial)
        if self.physical and (not phone_model or not expected_version):
            raise ValueError("A physical run requires the explicitly authorized model and QA version")
        self.serial = serial
        sdk = Path(os.environ.get("ANDROID_SDK_ROOT") or os.environ["ANDROID_HOME"])
        self.adb_path = sdk / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")
        if self.physical and self.adb("shell", "getprop", "ro.product.model").strip() != phone_model:
            raise ValueError("The connected phone model differs from the authorized model")
        if not self.physical and self.adb("emu", "avd", "name").splitlines()[0] != "steploop_skins_20261028":
            raise ValueError("Use the dedicated Steploop emulator")
        if f"package:{PACKAGE}" not in self.adb("shell", "pm", "list", "packages", PACKAGE):
            raise RuntimeError(f"Missing isolated package {PACKAGE}")
        package = self.adb("shell", "dumpsys", "package", PACKAGE)
        if expected_version and f"versionName={expected_version}-uiqa" not in package:
            raise RuntimeError("The installed QA package is not the expected build")
        self.version = re.findall(r"version(?:Name|Code)=\S+", package)[:2]
        self.out = out
        self.out.mkdir(parents=True, exist_ok=True)
        self.input_retries = []
        self.display_wakes = 0

    def adb(self, *args, binary=False, timeout=30):
        result = subprocess.run([str(self.adb_path), "-s", self.serial, *map(str, args)],
                                capture_output=True, check=True, timeout=timeout)
        return result.stdout if binary else result.stdout.decode("utf-8", errors="replace")

    def snapshot(self):
        dest = "/data/local/tmp/steploop-glass-qa.xml"
        result = self.adb("shell", "uiautomator", "dump", "--compressed", dest)
        if "dumped to:" not in result:
            return None, None
        xml = self.adb("shell", "cat", dest)
        return ET.fromstring(xml), xml

    @staticmethod
    def label(node):
        return node.attrib.get("text", "") + " " + node.attrib.get("content-desc", "")

    def wait(self, markers, timeout=45):
        deadline = time.monotonic() + timeout
        labels = []
        while time.monotonic() < deadline:
            try:
                tree, xml = self.snapshot()
            except (subprocess.SubprocessError, ET.ParseError):
                time.sleep(.35)
                continue
            if tree is not None and f'package="{PACKAGE}"' in xml:
                if any(value in xml for value in ("rn_redbox", "catalyst_redbox", "Unable to load script", "应用遇到问题")):
                    raise AssertionError(f"Application error: {xml[:900]}")
                labels = [self.label(n) for n in tree.iter("node")]
                if any(marker in label for marker in markers for label in labels):
                    return tree, xml
            time.sleep(.35)
        raise AssertionError(f"Screen did not reach {markers}: {labels[:22]}")

    def open(self, state, skin, mode):
        uri = f"steploop://uiqa?state={state}&skin={skin}&mode={mode}"
        self.adb("shell", "am", "force-stop", PACKAGE)
        output = self.adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW",
                          "-n", PACKAGE + "/com.zxn.palou.MainActivity", "-d", f"'{uri}'")
        if "Error" in output:
            raise RuntimeError(output)
        if state == "summary-history":
            markers = ("训练详情",)
        elif state.startswith("summary"):
            markers = CORE["summary"]
        elif state.startswith("climbing-"):
            markers = CORE["climbing"]
        else:
            markers = (CORE | SUPPORT | STATES).get(state, CORE["home"])
        tree, xml = self.wait(markers)
        if state.startswith("summary"):
            time.sleep(3.1)
            tree, xml = self.wait(markers)
        if state in ("home", "home-flow", "coach", "history", "settings", "calibrating", "empty"):
            # Read bounds after the native window and local artwork have settled.
            time.sleep(.8)
            tree, xml = self.wait(markers)
        return tree, xml

    def capture(self, label, xml):
        if f'package="{PACKAGE}"' not in xml:
            raise RuntimeError("The Android UI tree is outside the isolated test package")
        data = self.adb("exec-out", "screencap", "-p", binary=True)
        image = Image.open(io.BytesIO(data))
        image.verify()
        (self.out / f"{label}.png").write_bytes(data)
        (self.out / f"{label}.xml").write_text(xml, encoding="utf-8")
        return list(image.size)

    def node_for(self, tree, labels):
        matches = [node for node in tree.iter("node") if any(label == self.label(node).strip() or
                   label == node.get("text") or label == node.get("content-desc") for label in labels)]
        target = next((node for node in matches if node.get("clickable") == "true"), None)
        if target is None:
            target = next((node for node in tree.iter("node") if node.get("clickable") == "true" and
                           any(label in self.label(node) for label in labels)), None)
        if target is None and matches:
            target = matches[0]
        if target is None:
            raise AssertionError(f"Could not find {labels}")
        return target

    def display_is_dimmed(self):
        display = self.adb("shell", "dumpsys", "display")
        return bool(re.search(r"^\s*mBrightnessReason=[^\r\n]*\bdim\b", display, re.MULTILINE))

    def prepare_touch(self):
        if not self.physical or not self.display_is_dimmed():
            return
        windows = self.adb("shell", "dumpsys", "window")
        if not re.search(rf"^\s*mCurrentFocus=[^\r\n]*\s{re.escape(PACKAGE)}/", windows, re.MULTILINE):
            raise RuntimeError("The isolated QA app must have focus before waking the dimmed display")
        # On the Xiaomi 14 Ultra the first touch after dimming can only restore
        # brightness. A released modifier key restores it without a screen tap.
        self.adb("shell", "input", "keyboard", "keyevent", "KEYCODE_SHIFT_LEFT")
        deadline = time.monotonic() + 2
        while self.display_is_dimmed():
            if time.monotonic() >= deadline:
                raise RuntimeError("The display stayed dimmed; touch was not sent")
            time.sleep(.15)
        self.display_wakes += 1

    def tap(self, tree, labels, hold_ms=None, vertical=0.5):
        target = self.node_for(tree, labels)
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", target.get("bounds", "")))
        x, y = (x1 + x2) // 2, int(y1 + (y2 - y1) * vertical)
        self.prepare_touch()
        self.adb("shell", "input", "touchscreen", "swipe", x, y, x, y, hold_ms if hold_ms is not None else 115)
        time.sleep(.3)

    def activate(self, tree, labels, expected, *, vertical=0.5):
        target = self.node_for(tree, labels)
        before = self.label(target)
        self.tap(tree, labels, vertical=vertical)
        try:
            return self.wait(expected, timeout=5)
        except AssertionError:
            current, xml = self.snapshot()
            if xml is None or f'package="{PACKAGE}"' not in xml:
                raise
            target = self.node_for(current, labels)
            if self.label(target) != before or target.get("enabled") != "true":
                raise
            self.input_retries.append({"control": before.strip(), "bounds": target.get("bounds")})
            self.tap(current, labels, hold_ms=150, vertical=vertical)
            return self.wait(expected, timeout=10)

    def check_tabs(self, skin, mode):
        tree, _ = self.open("home", skin, mode)
        navigation = [("教练", CORE["coach"]), ("记录", CORE["history"]),
                      ("设置", CORE["settings"]), ("训练", CORE["home"])]
        for cycle in range(2):
            for slot, (label, markers) in enumerate(navigation, 1):
                node = self.node_for(tree, (label,))
                print(f"Dock {cycle + 1} {label}: {node.get('bounds')}", flush=True)
                self.tap(tree, (label,), vertical=0.5 if cycle == 0 else 0.68)
                tree, xml = self.wait(markers, timeout=10)
                node = self.node_for(tree, (label,))
                if node.get("selected") != "true":
                    raise AssertionError(f"Tab was not exposed as selected: {label}")
                if cycle == 0:
                    self.capture(f"dock-{slot}", xml)
        self.adb("shell", "input", "keyevent", 4)
        self.adb("shell", "am", "start", "-n", PACKAGE + "/com.zxn.palou.MainActivity")
        stats = self.adb("shell", "dumpsys", "gfxinfo", PACKAGE, "framestats")
        (self.out / "gfxinfo-tab-flow.txt").write_text(stats, encoding="utf-8")
        return "四个选中状态与重复导航"

    def check_history_search(self, skin, mode):
        tree, _ = self.open("history", skin, mode)
        tree, _ = self.activate(tree, ("搜索训练记录",), ("搜索楼栋或日期", "输入楼栋或日期"))
        fields = [node for node in tree.iter("node") if node.get("class") == "android.widget.EditText"]
        if not fields:
            raise AssertionError("History search did not expose an editable field")
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", fields[0].get("bounds", "")))
        self.adb("shell", "input", "tap", (x1+x2)//2, (y1+y2)//2)
        self.adb("shell", "input", "text", "SteploopNoMatch")
        self.wait(("没有匹配", "未找到", "没有找到", "没有符合", "暂无匹配",))
        return "记录搜索可聚焦，空结果可读"

    def check_home_drilldowns(self, skin, mode):
        tree, _ = self.open("home", skin, mode)
        tree, xml = self.activate(tree, ("查看高度完成情况",), ("关闭高度参照",))
        self.capture("home-ascent-reference", xml)
        tree, _ = self.open("home", skin, mode)
        tree, xml = self.activate(tree, ("查看本周每日趋势",), ("本周每日趋势",))
        self.capture("home-week-trend", xml)
        next_day = next((self.label(node).strip() for node in tree.iter("node")
                         if re.search(r"，[1-9]\d*层，查看当天训练", self.label(node)) and node.get("clickable") == "true"), None)
        if not next_day:
            raise AssertionError("The weekly trend did not expose a date with saved data")
        tree, xml = self.activate(tree, (next_day,), ("清除日期筛选，查看全部记录",))
        if not any("层 ·" in self.label(node) and "已完成" in self.label(node) for node in tree.iter("node")):
            raise AssertionError("The selected day did not retain its real records")
        self.capture("history-selected-day", xml)
        self.tap(tree, ("清除日期筛选，查看全部记录",))
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            _, xml = self.snapshot()
            if xml and f'package="{PACKAGE}"' in xml and "训练记录" in xml and "清除日期筛选" not in xml:
                self.capture("history-cleared-day", xml)
                break
        else:
            raise AssertionError("The date filter could not be cleared")
        tree, _ = self.open("home", skin, mode)
        tree, xml = self.activate(tree, ("查看最近训练",), ("重播盖楼动画",))
        self.capture("home-recent-detail", xml)
        self.tap(tree, ("重播盖楼动画",))
        _, xml = self.wait(("重播盖楼动画",))
        self.capture("completion-replay-route", xml)
        return "累计高度打开对照，每日趋势打开真实日期，筛选可清除，最近训练进入可重播结算"

    def check_calibration(self, skin, mode):
        tree, xml = self.open("calibrating", skin, mode)
        control = self.node_for(tree, ("到了一层",))
        before = re.search(r"记为 (\d+) 楼", self.label(control))
        if before is None:
            raise AssertionError("Manual floor control did not announce its next floor")
        self.capture("calibration-before", xml)
        old_floor = int(before.group(1))
        tree, xml = self.activate(tree, ("到了一层",), (f"记为 {old_floor + 1} 楼",))
        self.capture("calibration-after", xml)
        self.tap(tree, ("撤销上一次",))
        self.wait((f"记为 {old_floor} 楼",))
        return "标定+1实际楼层，撤销回原层"

    def check_main_page_actions(self, skin, mode):
        tree, _ = self.open("home", skin, mode)
        tree, _ = self.activate(tree, ("我的楼栋",), ("选择 运动中心",))
        _, xml = self.activate(tree, ("选择 运动中心",), ("当前 运动中心",))
        self.capture("home-changed-building", xml)

        tree, _ = self.open("coach", skin, mode)
        _, xml = self.activate(tree, ("目标体重管理课", "目标体重管理"), ("课程会陪你做什么", "每次训练怎样进行"))
        self.capture("coach-selected-course", xml)

        tree, _ = self.open("history", skin, mode)
        _, xml = self.activate(tree, ("展开长期趋势",), ("季度趋势",))
        self.capture("history-opened-trend", xml)

        tree, _ = self.open("empty", skin, mode)
        tree, xml = self.activate(tree, ("记录",), ("去训练首页",))
        self.capture("history-empty-action", xml)
        self.activate(tree, ("去训练首页",), CORE['home'])

        tree, _ = self.open("settings", skin, mode)
        tree, _ = self.activate(tree, ("反馈预览",), ("预览盖楼结算",))
        _, xml = self.activate(tree, ("预览盖楼结算",), ("盖楼结算预览，不生成训练记录", "结束结算预览"))
        self.capture("settings-opened-preview", xml)
        return "楼栋切换、课程详情、长期趋势、空记录回首页和结算预览均有去向"

    @contextmanager
    def record(self, name, seconds):
        remote = f"/data/local/tmp/steploop-qa-{name}.mp4"
        command = [str(self.adb_path), "-s", self.serial, "shell", "screenrecord",
                   "--time-limit", str(seconds), "--size", "576x1280", "--bit-rate", "3500000", remote]
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as recorder:
            try:
                time.sleep(.55)
                yield
                if recorder.poll() is not None:
                    raise AssertionError("The recording ended before the flow completed")
            finally:
                _, stderr = recorder.communicate(timeout=seconds + 6)
                if recorder.returncode != 0:
                    raise RuntimeError(stderr.decode("utf-8", errors="replace"))
                self.adb("pull", remote, self.out / (name + ".mp4"))

    def check_workout(self, skin, mode, record_completion=False):
        tree, _ = self.open("home-flow", skin, mode)
        self.tap(tree, ("开始爬楼",))
        tree, xml = self.wait(("正在向上", "确认结束训练"))
        self.capture("interaction-before-hold", xml)
        labels = ("长按结束", "结束训练", "确认结束训练")
        self.tap(tree, labels, hold_ms=180)
        tree, _ = self.wait(("正在向上", "确认结束训练"))
        recording = self.record("completion-flow", 17) if record_completion else nullcontext()
        with recording:
            self.tap(tree, labels, hold_ms=1500)
            tree, xml = self.wait(("训练完成", "本次成绩"))
            self.capture("interaction-after-hold", xml)
            if record_completion:
                time.sleep(2.5)
                _, xml = self.wait(("训练完成", "本次成绩"))
                self.capture("completion-finished", xml)
        return "短按保持训练，长按进入已存成绩"

    def check_completion_height(self, skin, mode):
        measurements = []
        roof = (105, 152, 230) if mode == "light" else (111, 155, 238)
        for label, floors in (("summary-single", 15), ("summary", 30), ("summary-long", 300)):
            tree, xml = self.open(label, skin, mode)
            artwork = self.node_for(tree, (f"代表本次 {floors} 层成绩的楼栋",))
            x0, y0, x1, y1 = map(int, re.findall(r"\d+", artwork.get("bounds", "")))
            self.capture(f"completion-{floors}", xml)
            with Image.open(self.out / f"completion-{floors}.png") as image:
                crop = image.convert("RGB").crop((x0, y0, x1, y1))
            pixels = crop.load()
            width, height = crop.size
            roof_top = next((y for y in range(height)
                             if sum(1 for x in range(width // 6, width * 5 // 6)
                                    if sum(abs(value - expected) for value, expected in
                                           zip(pixels[x, y], roof)) < 20) >= 8), None)
            if roof_top is None:
                raise AssertionError(f"Building roof was not visible for {floors} floors")
            measurements.append({"floors": floors, "roof_from_bottom_px": height - roof_top})
        if any(before["roof_from_bottom_px"] >= after["roof_from_bottom_px"]
               for before, after in zip(measurements, measurements[1:])):
            raise AssertionError(f"Building height must grow with actual floors: {measurements}")
        (self.out / "completion-heights.json").write_text(json.dumps(measurements, indent=2), encoding="utf-8")
        return "15、30、300 层的楼顶依次升高"

    def check_floor_motion(self, skin, mode):
        remote = "/data/local/tmp/steploop-glass-floor-motion.mp4"
        command = [str(self.adb_path), "-s", self.serial, "shell", "screenrecord",
                   "--time-limit", "20", "--size", "576x1280", "--bit-rate", "3000000", remote]
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as recorder:
            try:
                time.sleep(.7)
                _, xml = self.open("climbing-motion", skin, mode)
                if 'content-desc="9 楼"' not in xml:
                    raise AssertionError("Motion fixture missed its initial floor")
                self.capture("motion-floor-09", xml)
                _, xml = self.wait(("10 楼",))
                if recorder.poll() is not None:
                    raise AssertionError("The recording ended before the new floor appeared")
                self.capture("motion-floor-10", xml)
            finally:
                _, stderr = recorder.communicate(timeout=25)
                if recorder.returncode != 0:
                    raise RuntimeError(stderr.decode("utf-8", errors="replace"))
                self.adb("pull", remote, self.out / "floor-motion.mp4")
        return "合成上爬事件使当前层由 9 变为 10，原生录屏留证"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", default="emulator-5586")
    parser.add_argument("--phone-model")
    parser.add_argument("--expected-version")
    parser.add_argument("--skin", required=True)
    parser.add_argument("--mode", choices=("light", "dark"), default="light")
    parser.add_argument("--group", choices=("core", "all", "states"), default="core")
    parser.add_argument("--only", choices=tuple(CORE | SUPPORT | STATES))
    parser.add_argument("--flow", action="store_true")
    parser.add_argument("--flows-only", action="store_true")
    parser.add_argument("--tabs-only", action="store_true")
    parser.add_argument("--record-motion", action="store_true")
    parser.add_argument("--record-completion", action="store_true")
    parser.add_argument("--completion-height", action="store_true")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    lab = Lab(args.serial, args.out, args.phone_model, args.expected_version)
    states = [args.only] if args.only else CORE if args.group == "core" else CORE | SUPPORT if args.group == "all" else STATES
    receipt = {
        "serial": args.serial, "package": PACKAGE, "skin": args.skin, "mode": args.mode,
        "api": lab.adb("shell", "getprop", "ro.build.version.sdk").strip(),
        "size": lab.adb("shell", "wm", "size").strip(), "density": lab.adb("shell", "wm", "density").strip(),
        "font_scale": lab.adb("shell", "settings", "get", "system", "font_scale").strip(),
        "version": lab.version, "physical": lab.physical,
        "cases": [], "flows": [],
    }
    try:
        for state in ([] if args.flows_only or args.tabs_only else states):
            _, xml = lab.open(state, args.skin, args.mode)
            dimensions = lab.capture(state, xml)
            if args.skin == "glacier-glass" and state in ("climbing", "calibrating", "calibration_top", "descending", "waiting", "save-failed"):
                with Image.open(args.out / f"{state}.png") as screenshot:
                    x, y = 8, int(screenshot.height * .64)
                    rgb = screenshot.convert("RGB").getpixel((x, y))
                light_pixel = sum(rgb) / 3 > 145
                if light_pixel != (args.mode == "light"):
                    raise AssertionError(f"{state}: workout surface {rgb} does not follow {args.mode}")
            print(json.dumps({"state": state, "dimensions": dimensions}, ensure_ascii=False), flush=True)
            receipt["cases"].append({"state": state, "dimensions": dimensions})
        if args.flow or args.flows_only or args.tabs_only:
            receipt["flows"].append(lab.check_tabs(args.skin, args.mode))
        if args.flow or args.flows_only:
            receipt["flows"].append(lab.check_workout(args.skin, args.mode, args.record_completion))
            receipt["flows"].append(lab.check_calibration(args.skin, args.mode))
            receipt["flows"].append(lab.check_history_search(args.skin, args.mode))
            if args.skin == "glacier-glass":
                receipt["flows"].append(lab.check_home_drilldowns(args.skin, args.mode))
                receipt["flows"].append(lab.check_main_page_actions(args.skin, args.mode))
        if args.record_motion:
            receipt["flows"].append(lab.check_floor_motion(args.skin, args.mode))
        if args.completion_height:
            receipt["flows"].append(lab.check_completion_height(args.skin, args.mode))
    except Exception as error:
        receipt["error"] = str(error)
        try:
            _, failed_xml = lab.snapshot()
            if failed_xml and f'package="{PACKAGE}"' in failed_xml:
                lab.capture("failure", failed_xml)
        except (subprocess.SubprocessError, ET.ParseError) as capture_error:
            receipt["capture_error"] = str(capture_error)
        raise
    finally:
        receipt["display_wakes"] = lab.display_wakes
        receipt["input_retries"] = lab.input_retries
        (args.out / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
