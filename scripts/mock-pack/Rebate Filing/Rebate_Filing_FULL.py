"""Rebate_Filing_FULL.py (mock main)"""
import license_core

license_core.ensure_licensed("rebate")
print("APP3 OK — real hook ran:", license_core.ensure_licensed.__module__)
