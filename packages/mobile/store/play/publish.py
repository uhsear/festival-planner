#!/usr/bin/env python3
"""Reusable Google Play Developer API automation for Festie (us.festie.app).

Drives the parts of a Play Store release that DO have an API: store-listing
text, listing images/screenshots, and (experimentally) the Data safety form.
Binary uploads to a track are normally done via `eas submit`; a `submit`
helper is included for completeness.

The service-account key is NEVER stored in the repo. It is read from the
FESTIE_PLAY_SA_KEY env var (path to the JSON key). Get/keep that key from
Google Cloud Console -> IAM -> Service Accounts -> Keys, and keep it outside
version control (the repo .gitignore also blocks common key filenames).

Prereqs: pip install --user google-auth requests
The app entry for us.festie.app must already exist in Play Console (Google has
NO API to create an app) and the service account must be invited under
Play Console -> Users & permissions with release permissions.

Usage:
  python publish.py check
  python publish.py push-listing
  python publish.py push-images
  python publish.py push-data-safety path/to/data-safety.csv   # experimental
  python publish.py submit path/to/app.aab --track internal --status draft
"""
import argparse
import json
import os
import sys

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

PKG = "us.festie.app"
SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]
BASE = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PKG}"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_KEY = os.path.join(os.path.expanduser("~"), "Downloads", "festie-498100-f12b2708cdcd.json")

LIMITS = {"title": 30, "shortDescription": 80, "fullDescription": 4000}


def session():
    key = os.environ.get("FESTIE_PLAY_SA_KEY", DEFAULT_KEY)
    if not os.path.isfile(key):
        sys.exit(f"Service-account key not found. Set FESTIE_PLAY_SA_KEY (looked at: {key})")
    creds = service_account.Credentials.from_service_account_file(key, scopes=SCOPES)
    return AuthorizedSession(creds)


def _body(r):
    try:
        return r.json()
    except Exception:
        return r.text


def _die_on_404(r):
    if r.status_code == 404:
        sys.exit(
            "404 Package not found: us.festie.app.\n"
            "The app entry does not exist in Play Console yet. Create it once, by hand:\n"
            "  Play Console -> Create app -> name 'Festie' -> upload the first AAB to an\n"
            "  Internal testing track and opt into Play App Signing. Then this tool works."
        )


def new_edit(s):
    r = s.post(f"{BASE}/edits")
    _die_on_404(r)
    if r.status_code != 200:
        sys.exit(f"edits.insert failed {r.status_code}: {_body(r)}")
    return r.json()["id"]


def commit(s, eid):
    r = s.post(f"{BASE}/edits/{eid}:commit")
    if r.status_code != 200:
        sys.exit(f"commit failed {r.status_code}: {_body(r)}")
    print("committed edit", eid)


def cmd_check(s, args):
    eid = new_edit(s)
    for sub in ("tracks", "listings", "bundles"):
        r = s.get(f"{BASE}/edits/{eid}/{sub}")
        print(f"-- {sub} [{r.status_code}] --")
        print(json.dumps(_body(r), indent=1)[:1500])
    s.delete(f"{BASE}/edits/{eid}")
    print("OK: app exists and the service account has access.")


def cmd_push_listing(s, args):
    path = os.path.join(HERE, "listing.en-US.json")
    data = json.load(open(path, encoding="utf-8"))
    for field, limit in LIMITS.items():
        val = data.get(field, "")
        if len(val) > limit:
            sys.exit(f"{field} is {len(val)} chars, exceeds Play limit of {limit}")
    lang = data["language"]
    payload = {
        "language": lang,
        "title": data["title"],
        "shortDescription": data["shortDescription"],
        "fullDescription": data["fullDescription"],
    }
    if data.get("video"):
        payload["video"] = data["video"]
    eid = new_edit(s)
    r = s.put(f"{BASE}/edits/{eid}/listings/{lang}", json=payload)
    if r.status_code != 200:
        sys.exit(f"listings.update failed {r.status_code}: {_body(r)}")
    commit(s, eid)
    print(f"pushed listing for {lang}")


def cmd_push_images(s, args):
    """Upload images from images/<lang>/<imageType>/*.png (deletes existing first)."""
    img_root = os.path.join(HERE, "images")
    if not os.path.isdir(img_root):
        sys.exit(f"no images dir at {img_root}")
    eid = new_edit(s)
    for lang in sorted(os.listdir(img_root)):
        lang_dir = os.path.join(img_root, lang)
        if not os.path.isdir(lang_dir):
            continue
        for itype in sorted(os.listdir(lang_dir)):
            tdir = os.path.join(lang_dir, itype)
            if not os.path.isdir(tdir):
                continue
            s.delete(f"{BASE}/edits/{eid}/listings/{lang}/{itype}")
            for fn in sorted(os.listdir(tdir)):
                if not fn.lower().endswith((".png", ".jpg", ".jpeg")):
                    continue
                fp = os.path.join(tdir, fn)
                ctype = "image/png" if fn.lower().endswith(".png") else "image/jpeg"
                with open(fp, "rb") as fh:
                    r = s.post(
                        f"{UPLOAD}/edits/{eid}/listings/{lang}/{itype}?uploadType=media",
                        data=fh.read(),
                        headers={"Content-Type": ctype},
                    )
                ok = "ok" if r.status_code == 200 else f"FAIL {r.status_code}: {_body(r)}"
                print(f"  {lang}/{itype}/{fn} -> {ok}")
    commit(s, eid)


def cmd_push_data_safety(s, args):
    """EXPERIMENTAL: upload Data safety from a CSV exported from Play Console.
    Verify the request shape against the current androidpublisher docs before relying on it."""
    csv_path = args.csv
    if not os.path.isfile(csv_path):
        sys.exit(f"CSV not found: {csv_path}")
    contents = open(csv_path, encoding="utf-8").read()
    r = s.post(f"{BASE}/dataSafety", json={"safetyLabels": contents})
    print("dataSafety:", r.status_code, _body(r))
    if r.status_code != 200:
        print("NOTE: if this 4xx'd, the field/shape may differ — confirm in the API ref.")


def cmd_submit(s, args):
    """Upload an AAB and assign it to a track. (Normally use `eas submit`.)"""
    if not os.path.isfile(args.aab):
        sys.exit(f"AAB not found: {args.aab}")
    eid = new_edit(s)
    with open(args.aab, "rb") as fh:
        r = s.post(
            f"{UPLOAD}/edits/{eid}/bundles?uploadType=media",
            data=fh.read(),
            headers={"Content-Type": "application/octet-stream"},
        )
    if r.status_code != 200:
        sys.exit(f"bundles.upload failed {r.status_code}: {_body(r)}")
    version = r.json()["versionCode"]
    print("uploaded bundle versionCode", version)
    track = {
        "track": args.track,
        "releases": [{"status": args.status, "versionCodes": [str(version)]}],
    }
    r = s.put(f"{BASE}/edits/{eid}/tracks/{args.track}", json=track)
    if r.status_code != 200:
        sys.exit(f"tracks.update failed {r.status_code}: {_body(r)}")
    commit(s, eid)


def main():
    p = argparse.ArgumentParser(description="Festie Play Store API automation")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    sub.add_parser("push-listing")
    sub.add_parser("push-images")
    ds = sub.add_parser("push-data-safety")
    ds.add_argument("csv")
    sm = sub.add_parser("submit")
    sm.add_argument("aab")
    sm.add_argument("--track", default="internal")
    sm.add_argument("--status", default="draft", choices=["draft", "completed", "halted", "inProgress"])
    args = p.parse_args()

    s = session()
    {
        "check": cmd_check,
        "push-listing": cmd_push_listing,
        "push-images": cmd_push_images,
        "push-data-safety": cmd_push_data_safety,
        "submit": cmd_submit,
    }[args.cmd](s, args)


if __name__ == "__main__":
    main()
