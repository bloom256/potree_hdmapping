#!/usr/bin/env python3
"""Convert a trajectory CSV to trajectory.json for the Potree viewer.

Usage: python convert_trajectory_csv.py <trajectory.csv> [output.json]

Two input variants are accepted:
  - legacy: no header, columns timestamp,x,y,z,qx,qy,qz,qw
  - with header: optional '#' comment lines (e.g. CRS), then a header row
    such as lidar_ts_ns,x,y,z,qx,qy,qz,qw
With a header, x/y/z are looked up by name; otherwise columns 1, 2, 3 are used.
Output is a JSON array of [x, y, z] positions.
"""

import csv
import json
import os
import sys


def _is_number(value):
    try:
        float(value)
        return True
    except ValueError:
        return False


def parse_trajectory_csv(path):
    """Parse a trajectory CSV into a list of [x, y, z] positions.

    Blank lines and lines starting with '#' are ignored. If the first
    remaining row is not numeric it is taken as a header and the x, y, z
    columns are found by name; otherwise columns 1, 2, 3 are used
    (legacy format timestamp,x,y,z,qx,qy,qz,qw). Data rows that fail to
    parse are skipped.

    Returns:
        (positions, skipped) where positions is list of [x, y, z] and
        skipped is the count of unparseable data rows.
    """
    positions = []
    skipped = 0
    ix, iy, iz = 1, 2, 3
    header_seen = False
    with open(path, "r", newline="", encoding="utf-8") as f:
        lines = (line for line in f if line.strip() and not line.lstrip().startswith("#"))
        reader = csv.reader(lines)
        for row in reader:
            row = [cell.strip() for cell in row]
            if not header_seen:
                header_seen = True
                if row and not _is_number(row[0]):
                    names = [cell.lower() for cell in row]
                    try:
                        ix, iy, iz = names.index("x"), names.index("y"), names.index("z")
                    except ValueError:
                        raise ValueError(f"trajectory CSV header has no x, y, z columns: {row}")
                    continue
            try:
                x = float(row[ix])
                y = float(row[iy])
                z = float(row[iz])
            except (ValueError, IndexError):
                skipped += 1
                continue
            positions.append([x, y, z])
    return positions, skipped


def trajectory_to_json(positions, output_path):
    """Write positions list to a JSON file."""
    with open(output_path, "w") as f:
        json.dump(positions, f, separators=(",", ":"))


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <trajectory.csv> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        base, _ = os.path.splitext(input_path)
        output_path = base + ".json"

    if os.path.exists(output_path):
        print(f"Output already exists, skipping: {output_path}")
        return

    positions, skipped = parse_trajectory_csv(input_path)
    if skipped:
        print(f"Warning: skipped {skipped} unparseable rows", file=sys.stderr)
    trajectory_to_json(positions, output_path)
    print(f"Wrote {len(positions)} positions to {output_path}")


if __name__ == "__main__":
    main()
