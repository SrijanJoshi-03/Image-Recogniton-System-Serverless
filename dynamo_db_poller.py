import boto3 #library to talk to aws.
import json # most browsers accept response in json and event returned by aws serviees is in json format.
import os #to access the OS environment variables (bad practice), SSM should be used which will be added in future.
from botocore.exceptions import ClientError # to handle the client side errors like table not found, access denied etc.
from boto3.dynamodb.conditions import Key #dynamodb library to filter the dynamodb table.


dynamodb = boto3.resource('dynamodb', region_name='us-east-1') #calls aws dynamodb api in us-east-1 region.

# CORS headers — returned on every response so the browse doesn't block the fetch() call from the React frontend
CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
}

def build_response(status_code, body): 
    #Builds a standardized HTTP response with CORS headers
    #defined outside lambda_handler so if there is a warm start insted of cold this fuction already exists in the execution context.
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def lambda_handler(event, _):

    # 1. Extract imageId from the path — API Gateway maps
    #    GET /results/{imageId} → event['pathParameters']['imageId']
  
    path_params = event.get("pathParameters") or {}
    image_id = path_params.get("imageId", "").strip()

    if not image_id:
        return build_response(400, {"message": "imageId path parameter is required"})

    table = dynamodb.Table(os.environ["DYNAMODB_TABLE_NAME"])

    try:
  
        # 2. Query — much more efficient than Scan because we target
        #    a single partition key (image-id).
        #    The second lambda funciton stores at most 3 rows per image so
        #    pagination is not a concern here.
        response = table.query( #querying that exact PK instead of scanning the whoke table uskng PK and Sk.
            KeyConditionExpression=Key("image-id").eq(image_id)
        )
        items = response.get("Items", []) #Items in the response is what holds the datat and is a list object, so we use get to return empty list if any errors.

        # 3. No rows yet → Rekognition pipeline hasn't finished.
        #    Tell the frontend to keep polling.

        if not items:
            return build_response(200, {"status": "PROCESSING"})
        # 4. Collect every row whose status is 'processed'
        #    (this is what the second Lambda always writes).
        #    Decimal → float so json.dumps doesn't throw.
        labels = [
            {
                "Name":       item["label"],
                "Confidence": float(item["confidence"]),
            }
            for item in items
            if item.get("status") == "processed"
        ]

        if not labels:
            # if rows exist in dynamodb but none are processed yet.
            return build_response(200, {"status": "PROCESSING"})

        # 5. Return COMPLETED with labels sorted by confidence desc.
        #    The frontend checks data.status === "COMPLETED" to stop
        #    polling and render the label pills.
        labels.sort(key=lambda x: x["Confidence"], reverse=True) #sorts the 3 labels returned from Rekgonition that is stored in dynamodb based on their confidence percentage.

        return build_response(200, { #returns the response by calling the funciton definded above build_respose.
            "status": "COMPLETED",
            "imageId": image_id,
            "labels": labels,
        })

    except ClientError as e: #this lambda function returns this error if there is a clienterror.
        print(f"DynamoDB error: {e.response['Error']['Message']}")
        return build_response(500, {"message": "Failed to query results from DynamoDB"})

    except Exception as e: #this lambda funciton returns this error if there is any other unexpecte error.
        print(f"Unexpected error: {e}")
        return build_response(500, {"message": "Internal server error"})
