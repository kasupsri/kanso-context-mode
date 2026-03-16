export interface PolicyRuleSet {
  allow: string[];
  deny: string[];
  ask: string[];
  fileDeny: string[];
}

const SHARED_FILE_DENY = [
  '.env',
  '**/.env*',
  '**/*secret*',
  '**/*credential*',
  '**/*.pem',
  '**/*id_rsa*',
];

const WINDOWS_STRICT_DENY = [
  '*Remove-Item* -Recurse* -Force*',
  '*del * /s * /q *',
  '*rmdir* /s* /q*',
  '*format *',
  '*diskpart*',
  '*reg delete*',
  '*bcdedit*',
  '*cipher /w*',
  '*shutdown*',
  '*Stop-Computer*',
  '*Restart-Computer*',
  '*Start-Process* -Verb RunAs*',
  '*runas*',
  '*Invoke-WebRequest* | *iex*',
  '*curl* | *iex*',
  '*irm* | *iex*',
];

const WINDOWS_BALANCED_DENY = [
  '*format *',
  '*diskpart*',
  '*reg delete*',
  '*bcdedit*',
  '*cipher /w*',
  '*Start-Process* -Verb RunAs*',
  '*runas*',
  '*Invoke-WebRequest* | *iex*',
  '*curl* | *iex*',
  '*irm* | *iex*',
];

const WINDOWS_BALANCED_ASK = [
  '*Remove-Item* -Recurse* -Force*',
  '*del * /s * /q *',
  '*rmdir* /s* /q*',
  '*shutdown*',
  '*Restart-Computer*',
];

const POSIX_STRICT_DENY = [
  '*rm * -rf *',
  '*rm -rf *',
  '*rm * -fr *',
  '*mkfs*',
  '*fdisk*',
  '*parted*',
  '*dd * of=/dev/*',
  '*shutdown*',
  '*reboot*',
  '*halt*',
  '*poweroff*',
  '*systemctl* reboot*',
  '*systemctl* poweroff*',
  '*launchctl* reboot*',
  '*curl* | *sh*',
  '*curl* | *bash*',
  '*wget* -O-* | *sh*',
  '*wget* -qO-* | *bash*',
];

const POSIX_BALANCED_DENY = [
  '*mkfs*',
  '*fdisk*',
  '*parted*',
  '*dd * of=/dev/*',
  '*curl* | *sh*',
  '*curl* | *bash*',
  '*wget* -O-* | *sh*',
  '*wget* -qO-* | *bash*',
];

const POSIX_BALANCED_ASK = [
  '*rm * -rf *',
  '*rm -rf *',
  '*rm * -fr *',
  '*shutdown*',
  '*reboot*',
  '*halt*',
  '*poweroff*',
  '*systemctl* reboot*',
  '*systemctl* poweroff*',
  '*launchctl* reboot*',
];

function windowsRules(mode: 'strict' | 'balanced'): PolicyRuleSet {
  if (mode === 'balanced') {
    return {
      allow: [],
      deny: WINDOWS_BALANCED_DENY,
      ask: WINDOWS_BALANCED_ASK,
      fileDeny: SHARED_FILE_DENY,
    };
  }

  return {
    allow: [],
    deny: WINDOWS_STRICT_DENY,
    ask: [],
    fileDeny: SHARED_FILE_DENY,
  };
}

function posixRules(mode: 'strict' | 'balanced'): PolicyRuleSet {
  if (mode === 'balanced') {
    return {
      allow: [],
      deny: POSIX_BALANCED_DENY,
      ask: POSIX_BALANCED_ASK,
      fileDeny: SHARED_FILE_DENY,
    };
  }

  return {
    allow: [],
    deny: POSIX_STRICT_DENY,
    ask: [],
    fileDeny: SHARED_FILE_DENY,
  };
}

export function policyByMode(
  mode: 'strict' | 'balanced' | 'permissive',
  platform: NodeJS.Platform = process.platform
): PolicyRuleSet {
  if (mode === 'permissive') {
    return {
      allow: ['*'],
      deny: [],
      ask: [],
      fileDeny: SHARED_FILE_DENY,
    };
  }

  if (platform === 'win32') {
    return windowsRules(mode);
  }
  return posixRules(mode);
}
