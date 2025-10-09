#!/usr/bin/env python3
import subprocess
import re
from datetime import datetime
import csv
import os

class SpamCallRecorder:
    def __init__(self, csv_file='spam_calls_record.csv'):
        self.csv_file = csv_file
        self.initialize_csv()
        
    def initialize_csv(self):
        if not os.path.exists(self.csv_file):
            with open(self.csv_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['Number', 'Label', 'Date', 'Time', 'DisplayName'])
            print(f"创建新的 CSV 文件: {self.csv_file}")
        else:
            print(f"使用现有 CSV 文件: {self.csv_file}")
    
    def extract_phone_number(self, line):
        match = re.search(r'mAddress:\s*([^,\)]+)', line)
        if match:
            number = match.group(1).strip()
            if 'XXX' not in number:
                return number
        return None
    
    def extract_display_name(self, line):
        match = re.search(r'mDisplayName:\s*([^,\)]+)', line)
        if match:
            name = match.group(1).strip()
            if 'XXX' not in name and name != 'NULL':
                return name
        return ''
    
    def determine_label(self, line):
        spam_match = re.search(r'mIsSpamOrRisk:\s*(true|false)', line)
        is_spam = spam_match and spam_match.group(1) == 'true'
        
        if not is_spam:
            return 'Regular'
        
        line_lower = line.lower()
        if 'telemarket' in line_lower:
            return 'Telemarketing'
        elif 'scam' in line_lower:
            return 'Scam Likely'
        else:
            return 'Spam'
    
    def record_call(self, number, label, display_name=''):
        now = datetime.now()
        date = now.strftime('%Y-%m-%d')
        time = now.strftime('%H:%M:%S')
        
        with open(self.csv_file, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([number, label, date, time, display_name])
        
        print(f"\n{'='*60}")
        print(f"[记录] {date} {time}")
        print(f"  号码: {number}")
        print(f"  标签: {label}")
        if display_name:
            print(f"  名称: {display_name}")
        print(f"  已保存到 CSV file: {self.csv_file}")
        print('='*60)
    
    def start_monitoring(self):
        print("=" * 60)
        print("Debug mode - show all related logs")
        print(f"CSV file: {self.csv_file}")
        print("Press Ctrl+C to stop")
        print("=" * 60)
        print("\nStarting to monitor all logs...\n")
        
        recorded_calls = set()
        line_count = 0
        
        try:
            process = subprocess.Popen(
                ['adb', 'logcat', '-v', 'time'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                universal_newlines=True,
                bufsize=1
            )
            
            for line in process.stdout:
                line_count += 1
                
                # 每100行显示一次心跳
                if line_count % 100 == 0:
                    print(f"[Heartbeat] Processed {line_count} log lines...")
                
                # 显示所有包含通话相关的日志
                if any(keyword in line for keyword in 
                       ['CallerInfo', 'CallCard', 'InCall', 'Telecom']):
                    print(f"[DEBUG] {line.strip()}")
                
                # 尝试记录
                if 'CallerInfoData' in line and 'mIsSpamOrRisk' in line:
                    print(f"\n[Match] Found CallerInfoData!")
                    print(f"  Full log: {line.strip()}\n")
                    
                    number = self.extract_phone_number(line)
                    
                    if number:
                        print(f"  Extracted number: {number}")
                        if number not in recorded_calls:
                            label = self.determine_label(line)
                            display_name = self.extract_display_name(line)
                            
                            self.record_call(number, label, display_name)
                            recorded_calls.add(number)
                    else:
                        print(f"  Cannot extract number")
        
        except KeyboardInterrupt:
            print(f"\n\nMonitoring stopped (processed {line_count} log lines)")
            print(f"Data saved to: {self.csv_file}")
            self.show_statistics()
    
    def show_statistics(self):
        try:
            with open(self.csv_file, 'r') as f:
                reader = csv.DictReader(f)
                rows = list(reader)
                
                if not rows:
                    print("No records")
                    return
                
                total = len(rows)
                regular = sum(1 for row in rows if row['Label'] == 'Regular')
                telemarketing = sum(1 for row in rows if row['Label'] == 'Telemarketing')
                scam = sum(1 for row in rows if row['Label'] == 'Scam Likely')
                spam = sum(1 for row in rows if row['Label'] == 'Spam')
                
                print("\nStatistics:")
                print(f"  Total records: {total}")
                print(f"  正常通话: {regular}")
                print(f"  Telemarketing: {telemarketing}")
                print(f"  Scam Likely: {scam}")
                print(f"  Spam: {spam}")
        except Exception as e:
            print(f"Cannot read statistics: {e}")

if __name__ == '__main__':
    recorder = SpamCallRecorder()
    recorder.start_monitoring()