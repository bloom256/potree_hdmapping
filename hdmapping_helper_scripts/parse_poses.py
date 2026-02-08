#!/usr/bin/env python3
"""Parse poses text files (4x4 transformation matrices indexed by filename).

File format:
    <number_of_point_clouds>
    <point_cloud_filename_1>
    r11 r12 r13 tx
    r21 r22 r23 ty
    r31 r32 r33 tz
    0 0 0 1
    <point_cloud_filename_2>
    ...

Usage as module:
    from parse_poses import parse_poses_file, poses_to_json
    poses = parse_poses_file("poses.txt")
    poses_to_json(poses, "poses.json")

Usage standalone:
    python parse_poses.py <poses.txt> [output.json]
"""

import json
import os
import sys


def parse_poses_file(path):
    """Parse a poses text file into a list of dicts.

    Returns:
        list of {"filename": str, "matrix": [16 floats]} (row-major 4x4)
    """
    with open(path, "r") as f:
        lines = [l.strip() for l in f if l.strip()]

    if not lines:
        raise ValueError(f"Empty poses file: {path}")

    num_poses = int(lines[0])
    poses = []
    i = 1
    for _ in range(num_poses):
        if i >= len(lines):
            raise ValueError(f"Unexpected end of file at line {i + 1}")
        filename = lines[i]
        i += 1

        matrix = []
        for row in range(4):
            if i >= len(lines):
                raise ValueError(f"Unexpected end of file at line {i + 1}")
            values = lines[i].split()
            if len(values) != 4:
                raise ValueError(
                    f"Expected 4 values on line {i + 1}, got {len(values)}: {lines[i]}"
                )
            matrix.extend(float(v) for v in values)
            i += 1

        poses.append({"filename": filename, "matrix": matrix})

    return poses


def poses_to_json(poses, output_path):
    """Write poses list to a JSON file."""
    with open(output_path, "w") as f:
        json.dump(poses, f, separators=(",", ":"))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <poses.txt> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        output_path = os.path.splitext(input_path)[0] + ".json"

    poses = parse_poses_file(input_path)
    poses_to_json(poses, output_path)
    print(f"Wrote {len(poses)} poses to {output_path}")
