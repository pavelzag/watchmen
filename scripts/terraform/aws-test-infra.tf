provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

# ── Networking (Minimal VPC to avoid "No default VPC" errors) ──────────────

resource "aws_vpc" "test" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "watchmen-test-vpc" }
}

resource "aws_subnet" "test_a" {
  vpc_id            = aws_vpc.test.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "${var.aws_region}a"
  tags              = { Name = "watchmen-test-subnet-a" }
}

resource "aws_subnet" "test_b" {
  vpc_id            = aws_vpc.test.id
  cidr_block        = "10.0.2.0/24"
  availability_zone = "${var.aws_region}b"
  tags              = { Name = "watchmen-test-subnet-b" }
}

resource "aws_internet_gateway" "test" {
  vpc_id = aws_vpc.test.id
  tags   = { Name = "watchmen-test-igw" }
}

resource "aws_route_table" "test" {
  vpc_id = aws_vpc.test.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.test.id
  }
}

resource "aws_route_table_association" "test" {
  subnet_id      = aws_subnet.test_a.id
  route_table_id = aws_route_table.test.id
}

resource "aws_db_subnet_group" "test" {
  name       = "watchmen-test-db-subnet-group"
  subnet_ids = [aws_subnet.test_a.id, aws_subnet.test_b.id]
}

# ── AMI Lookup (Dynamic) ───────────────────────────────────────────────────

data "aws_ami" "amazon_linux_2" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

# ── Resources ─────────────────────────────────────────────────────────────

# 1. Minimal S3 Bucket
resource "aws_s3_bucket" "test_bucket" {
  bucket = "watchmen-test-bucket-${random_id.id.hex}"
}

resource "aws_s3_bucket_public_access_block" "dirty" {
  bucket = aws_s3_bucket.test_bucket.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

# 2. Cheapest EC2 Instance (t3.nano)
resource "aws_instance" "test_vm" {
  ami                         = data.aws_ami.amazon_linux_2.id
  instance_type               = "t3.nano"
  subnet_id                   = aws_subnet.test_a.id
  vpc_security_group_ids      = [aws_security_group.open_sg.id]
  associate_public_ip_address = true

  tags = { Name = "watchmen-test-vm" }
}

# 3. Open Security Group
resource "aws_security_group" "open_sg" {
  name        = "watchmen-test-open-sg"
  vpc_id      = aws_vpc.test.id
  description = "Open SG for Watchmen testing"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# 4. Minimal RDS Instance
resource "aws_db_instance" "test_db" {
  allocated_storage      = 20
  db_name                = "watchmentestdb"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.micro"
  username               = "postgres"
  password               = "Password123!"
  parameter_group_name   = "default.postgres16"
  skip_final_snapshot    = true
  publicly_accessible    = true
  db_subnet_group_name   = aws_db_subnet_group.test.name
  vpc_security_group_ids = [aws_security_group.open_sg.id]
}

# 5. Simple Lambda Function
resource "aws_iam_role" "lambda_exec" {
  name = "watchmen-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_lambda_function" "test_lambda" {
  filename         = "lambda_function_payload.zip"
  function_name    = "watchmen-test-lambda"
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  source_code_hash = filebase64sha256("lambda_function_payload.zip")
}

# 6. SNS Topic
resource "aws_sns_topic" "test_topic" {
  name = "watchmen-test-topic"
}

# 7. Secrets Manager Secret
resource "aws_secretsmanager_secret" "test_secret" {
  name = "watchmen-test-secret-${random_id.id.hex}"
}

# ── IAM Scanner User ────────────────────────────────────────────────────────

resource "aws_iam_user" "scanner" {
  name = "watchmen-scanner"
  tags = { Purpose = "Cloud Scanning" }
}

resource "aws_iam_user_policy_attachment" "readonly" {
  user       = aws_iam_user.scanner.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_access_key" "scanner_key" {
  user = aws_iam_user.scanner.name
}

output "aws_access_key_id" {
  value = aws_iam_access_key.scanner_key.id
}

output "aws_secret_access_key" {
  value     = aws_iam_access_key.scanner_key.secret
  sensitive = true
}

resource "random_id" "id" {
  byte_length = 4
}
