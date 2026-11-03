#!/bin/sh
# Stage 2 of the execution sandbox. Runs INSIDE fresh net/mount/pid/ipc/uts namespaces (see exec_sandbox.py).
# Builds a NEW ROOT from an allow-list (read-only /usr, /etc, libraries, a minimal /dev, /proc, and the dispatch workdir at /srv),
# chroots into it, drops privileges, then runs the command under resource limits and a hard wall clock. Nothing else on the
# host (the repo checkout, /tmp, /home, earlier artifacts, hidden tests) is visible. Fails closed: any setup error aborts (exit 97).
# Env in: SBX_WORK (path of the workdir INSIDE the new root, /srv), SBX_HOST_WORK (the dispatch's tmpfs, bound there),
# SBX_ROOT_MOUNT (an existing empty host dir to mount the new root on, default /media), SBX_WORK_BYTES, SBX_CPU_S, SBX_AS_BYTES,
# SBX_NPROC, SBX_NOFILE, SBX_FSIZE, SBX_WALL_S
set -eu
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH
NR="${SBX_ROOT_MOUNT:-/media}"
fail() { echo "sandbox-setup: $1" >&2; exit 97; }
[ -d "$NR" ] || fail "root mount point $NR missing"
[ -z "$(ls -A "$NR")" ] || fail "root mount point $NR is not empty"
mount --make-rprivate /
mount -t tmpfs -o size=4m,mode=0755 tmpfs "$NR"
for d in usr etc; do
  mkdir "$NR/$d"; mount --bind "/$d" "$NR/$d"
  mount -o remount,bind,ro "$NR/$d" || fail "cannot remount /$d read-only"
done
for d in bin sbin lib lib64 lib32; do   # merged-usr symlinks, or real directories bound read-only
  if [ -L "/$d" ]; then ln -s "$(readlink "/$d")" "$NR/$d"
  elif [ -d "/$d" ]; then mkdir "$NR/$d"; mount --bind "/$d" "$NR/$d"; mount -o remount,bind,ro "$NR/$d" || fail "cannot remount /$d read-only"
  fi
done
mkdir "$NR/dev" "$NR/proc" "$NR/srv"
for f in null zero urandom random full; do : > "$NR/dev/$f"; mount --bind "/dev/$f" "$NR/dev/$f"; done
mount -t proc proc "$NR/proc"
mount --bind "$SBX_HOST_WORK" "$NR$SBX_WORK"
mount -o remount,bind,ro "$NR" || fail "cannot remount the new root read-only"
cd "$NR"
exec chroot . /bin/sh -c 'cd "$SBX_WORK" && exec prlimit --cpu="$SBX_CPU_S" --as="$SBX_AS_BYTES" --nproc="$SBX_NPROC" --nofile="$SBX_NOFILE" --fsize="$SBX_FSIZE" -- timeout --signal=KILL "$SBX_WALL_S" setpriv --reuid=65534 --regid=65534 --clear-groups --no-new-privs -- "$@"' sh "$@"
