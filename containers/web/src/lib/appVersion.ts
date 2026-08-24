import { useEffect, useState } from "react";

/** 빌드 시 주입. 컨테이너는 containers/VERSION, 로컬은 package 또는 VERSION 파일. */
export function bakedAppVersion(): string {
  try {
    return typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "";
  } catch {
    return "";
  }
}

export function useAppVersion(): string {
  const [version, setVersion] = useState(bakedAppVersion);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/health", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { appVersion?: string } | null) => {
        const next = body?.appVersion?.trim();
        if (!cancelled && next) setVersion(next);
      })
      .catch(() => {
        /* 빌드 버전 유지 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return version;
}
