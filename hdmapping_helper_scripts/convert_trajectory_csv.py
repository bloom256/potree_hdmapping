#!/usr/bin/env python3
"""Convert a trajectory CSV to trajectory.json for the Potree viewer.

Usage: python convert_trajectory_csv.py <trajectory.csv> [output.json]

Input CSV has no header. Columns: timestamp,x,y,z,qx,qy,qz,qw
Output is a JSON array of [x, y, z] positions (columns 1, 2, 3).
"""

import csv
import json
import os
import sys


def parse_trajectory_csv(path):
    """Parse a trajectory CSV into a list of [x, y, z] positions.

    Input CSV has no header. Columns: timestamp,x,y,z,qx,qy,qz,qw.
    Rows that fail to parse are skipped.

    Returns:
        (positions, skipped) where positions is list of [x, y, z] and
        skipped is the count of unparseable rows.
    """
    positions = []
    skipped = 0
    with open(path, "r", newline="") as f:
        reader = csv.reader(f)
        for row_num, row in enumerate(reader, start=1):
            if len(row) < 4:
                skipped += 1
                continue
            try:
                x = float(row[1])
                y = float(row[2])
                z = float(row[3])
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
