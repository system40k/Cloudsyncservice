terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Configure a pre-created, encrypted, versioned S3 state bucket before init.
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "cloudsync"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

# CloudFront-scope WAF resources must be created in us-east-1, independent of
# the selected S3/Cognito region.
provider "aws" {
  alias  = "use1"
  region = "us-east-1"

  default_tags {
    tags = {
      Application = "cloudsync"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}
